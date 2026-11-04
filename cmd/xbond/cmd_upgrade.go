package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/openxbond/xbond/internal/daemon"
	"github.com/openxbond/xbond/internal/daemon/service"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/upgrade"
	"github.com/openxbond/xbond/internal/version"
	"github.com/spf13/cobra"
)

func init() {
	var check, yes bool
	cmd := &cobra.Command{
		Use:   "upgrade",
		Short: "Check for or install a signed XBond CLI release",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runUpgrade(cmd, check, yes)
		},
	}
	cmd.Flags().BoolVar(&check, "check", false, "Check for updates without installing")
	cmd.Flags().BoolVar(&yes, "yes", false, "Install without asking for confirmation")
	cmd.MarkFlagsMutuallyExclusive("check", "yes")
	rootCmd.AddCommand(cmd)
	daemonCmd.AddCommand(&cobra.Command{
		Use:    "apply-bundled-update",
		Hidden: true,
		Args:   cobra.NoArgs,
		RunE:   applyDesktopBundle,
	})
}

func runUpgrade(cmd *cobra.Command, check, yes bool) error {
	if inContainer() {
		return errors.New("update this container by pulling the desired GHCR image tag and recreating it with the same data volume")
	}
	if version.ReleasePublicKey == "" {
		return fmt.Errorf("this development build has no release key; download an official binary from %s", upgrade.DownloadURL)
	}
	self, err := executablePath()
	if err != nil {
		return err
	}
	if samePath(self, desktopBinaryPath()) {
		return errors.New("this daemon is managed by XBond Desktop; use the updater in Settings")
	}
	if packageManaged(self) {
		return errors.New("this installation is managed by a package manager; update it with the same package manager")
	}

	current, err := upgrade.VersionCode(version.Version)
	if err != nil {
		return err
	}
	release, err := upgrade.Fetch(cmd.Context(), version.ReleasePublicKey)
	if err != nil {
		return err
	}
	if release.Build <= current {
		fmt.Fprintf(cmd.OutOrStdout(), "XBond %s is up to date.\n", version.Version)
		return nil
	}
	asset, err := release.CLI()
	if err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "XBond %s is available (installed %s).\n", release.Version, version.Version)
	if check {
		return nil
	}
	if err := ensureNoMachineOwner(self); err != nil {
		return err
	}
	if !yes {
		if input, ok := cmd.InOrStdin().(*os.File); ok {
			if info, err := input.Stat(); err != nil || info.Mode()&os.ModeCharDevice == 0 {
				return errors.New("pass --yes to install without an interactive terminal")
			}
		}
		fmt.Fprint(cmd.OutOrStdout(), "Install this update? A managed daemon may restart briefly. [y/N] ")
		answer, _ := bufio.NewReader(cmd.InOrStdin()).ReadString('\n')
		answer = strings.ToLower(strings.TrimSpace(answer))
		if answer != "y" && answer != "yes" {
			fmt.Fprintln(cmd.OutOrStdout(), "Update canceled.")
			return nil
		}
	}
	staged, err := asset.Download(cmd.Context(), filepath.Dir(self))
	if err != nil {
		return err
	}
	if err := verifyBinary(staged, release.Version); err != nil {
		_ = os.Remove(staged)
		return err
	}
	return installCLIUpdate(cmd, self, staged, release.Version, asset.SHA256)
}

type desktopUpdateResult struct {
	State   string `json:"state"`
	Path    string `json:"path,omitempty"`
	Running bool   `json:"running"`
}

func applyDesktopBundle(cmd *cobra.Command, _ []string) error {
	if version.ReleasePublicKey == "" {
		return errors.New("bundle synchronization requires an official build")
	}
	source, err := executablePath()
	if err != nil {
		return err
	}
	target := desktopBinaryPath()
	if samePath(source, target) {
		return errors.New("bundle synchronization must be run from the desktop package")
	}
	release, err := upgrade.Lock(paths.DataDir())
	if err != nil {
		return err
	}
	defer release()

	result, err := syncDesktop(source, target)
	if err != nil {
		return err
	}
	return json.NewEncoder(cmd.OutOrStdout()).Encode(result)
}

func syncDesktop(source, target string) (desktopUpdateResult, error) {
	var result desktopUpdateResult
	registered, owned, err := service.UserRegistration(target)
	if err != nil {
		return result, err
	}
	running, err := daemon.InstanceLockHeld(paths.DataDir())
	if err != nil {
		return result, err
	}
	if !owned && (registered || running) {
		return desktopUpdateResult{State: "external", Running: running}, nil
	}

	bundleCode, err := upgrade.VersionCode(version.Version)
	if err != nil {
		return result, err
	}
	current, err := installedVersion(target)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return result, err
	}
	result = desktopUpdateResult{State: "managed", Path: target, Running: running}
	if current != "" {
		currentCode, err := upgrade.VersionCode(current)
		if err != nil {
			return result, err
		}
		if currentCode > bundleCode {
			return result, fmt.Errorf("managed daemon %s is newer than desktop bundle %s", current, version.Version)
		}
		if owned && currentCode == bundleCode {
			if running {
				_, _, err = runningDaemon(target, current)
			}
			return result, err
		}
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return result, err
	}
	staged, err := upgrade.Copy(filepath.Dir(target), source)
	if err != nil {
		return result, err
	}
	defer os.Remove(staged)
	if err := verifyBinary(staged, version.Version); err != nil {
		return result, err
	}
	if err := replaceManagedBinary(target, staged, version.Version, !registered); err != nil {
		return result, err
	}
	result.Running = running || !registered
	return result, nil
}

func executablePath() (string, error) {
	path, err := service.SelfPath()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(path)
}

func desktopBinaryPath() string {
	name := "xbond"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	dataDir := paths.DataDir()
	if absolute, err := filepath.Abs(dataDir); err == nil {
		dataDir = absolute
	}
	if canonical, err := filepath.EvalSymlinks(dataDir); err == nil {
		dataDir = canonical
	} else if parent, err := filepath.EvalSymlinks(filepath.Dir(dataDir)); err == nil {
		dataDir = filepath.Join(parent, filepath.Base(dataDir))
	}
	return filepath.Join(dataDir, "desktop", name)
}

func samePath(a, b string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
	}
	return filepath.Clean(a) == filepath.Clean(b)
}

func inContainer() bool {
	for _, marker := range []string{"/.dockerenv", "/run/.containerenv"} {
		if _, err := os.Stat(marker); err == nil {
			return true
		}
	}
	return os.Getenv("XBOND_INSTALL_CHANNEL") == "container"
}

func packageManaged(exe string) bool {
	path := strings.ToLower(filepath.ToSlash(exe))
	for _, root := range []string{"/nix/store/", "/opt/homebrew/cellar/", "/usr/local/cellar/", "/snap/", "/usr/bin/"} {
		if strings.HasPrefix(path, root) {
			return true
		}
	}
	return strings.Contains(path, "/microsoft/winget/packages/") || strings.Contains(path, "/scoop/apps/")
}

func ensureNoMachineOwner(exe string) error {
	_, owned, err := service.SystemRegistration(exe)
	if err != nil {
		return fmt.Errorf("inspect machine daemon registration: %w", err)
	}
	if owned {
		return errors.New("a machine-level service uses this executable; have its administrator stop and update the machine installation")
	}
	return nil
}

func installedVersion(path string) (string, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("expected a regular executable at %s", path)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, path, "version", "--json")
	quietUpgradeCommand(command)
	output, err := command.Output()
	if err != nil {
		return "", fmt.Errorf("read XBond binary version: %w", err)
	}
	var infoJSON version.Info
	if err := json.Unmarshal(output, &infoJSON); err != nil {
		return "", err
	}
	if infoJSON.OS != runtime.GOOS || infoJSON.Arch != runtime.GOARCH {
		return "", errors.New("binary has the wrong platform or architecture")
	}
	return infoJSON.ClientVersion, nil
}

func verifyBinary(path, expected string) error {
	current, err := installedVersion(path)
	if err != nil {
		return err
	}
	if current != expected {
		return fmt.Errorf("binary version %q does not match release %q", current, expected)
	}
	return nil
}
