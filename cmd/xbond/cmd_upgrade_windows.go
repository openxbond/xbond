package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/upgrade"
	"github.com/spf13/cobra"
	"golang.org/x/sys/windows"
)

func quietUpgradeCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}
}

func renameUpgradeBinary(source, target string) error {
	deadline := time.Now().Add(2 * time.Second)
	for {
		err := os.Rename(source, target)
		if !errors.Is(err, windows.ERROR_SHARING_VIOLATION) && !errors.Is(err, windows.ERROR_ACCESS_DENIED) {
			return err
		}
		if time.Now().After(deadline) {
			return err
		}
		// The daemon may have released its instance lock but still be
		// returning from main. Antivirus may also hold a short-lived handle.
		time.Sleep(100 * time.Millisecond)
	}
}

func init() {
	rootCmd.AddCommand(&cobra.Command{
		Use:    "upgrade-apply",
		Hidden: true,
		Args:   cobra.ExactArgs(5),
		RunE:   runWindowsUpgradeHelper,
	})
}

func installCLIUpdate(cmd *cobra.Command, target, staged, next, checksum string) (err error) {
	defer func() {
		if err != nil {
			_ = os.Remove(staged)
		}
	}()
	dataDir, err := filepath.Abs(paths.DataDir())
	if err != nil {
		return err
	}
	release, err := upgrade.Lock(dataDir)
	if err != nil {
		return err
	}
	defer release()

	helper := filepath.Join(dataDir, "xbond-upgrade-helper.exe")
	if samePath(target, helper) {
		return errors.New("cannot update the upgrade helper directly")
	}
	tmp, err := upgrade.Copy(dataDir, target)
	if err != nil {
		return err
	}
	defer os.Remove(tmp)
	if err := os.Rename(tmp, helper); err != nil {
		return fmt.Errorf("prepare the upgrade helper: %w", err)
	}
	process := exec.Command(helper, "upgrade-apply", strconv.Itoa(os.Getpid()), target, staged, next, checksum)
	process.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP}
	process.Stdout = cmd.OutOrStdout()
	process.Stderr = cmd.ErrOrStderr()
	if err := process.Start(); err != nil {
		return fmt.Errorf("start the upgrade helper: %w", err)
	}
	if err := process.Process.Release(); err != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "The upgrade helper started but its handle could not be closed: %v\n", err)
	}
	fmt.Fprintln(cmd.OutOrStdout(), "The upgrade helper will finish after this process exits.")
	return nil
}

func runWindowsUpgradeHelper(cmd *cobra.Command, args []string) error {
	self, err := executablePath()
	if err != nil {
		return err
	}
	if !samePath(filepath.Base(self), "xbond-upgrade-helper.exe") {
		return errors.New("this command must run from the upgrade helper")
	}
	pid, err := strconv.ParseUint(args[0], 10, 32)
	if err != nil || pid == 0 {
		return errors.New("invalid parent process ID")
	}
	target, staged, next, checksum := args[1], args[2], args[3], args[4]
	if !filepath.IsAbs(target) || !filepath.IsAbs(staged) ||
		!samePath(filepath.Dir(target), filepath.Dir(staged)) ||
		!strings.HasPrefix(filepath.Base(staged), ".xbond-stage-") {
		return errors.New("invalid staged update path")
	}
	defer os.Remove(staged)
	if err := waitForParent(uint32(pid)); err != nil {
		return err
	}
	release, err := upgrade.Lock(paths.DataDir())
	if err != nil {
		return err
	}
	defer release()
	if actual, err := upgrade.Checksum(staged); err != nil || !strings.EqualFold(actual, checksum) {
		return errors.New("staged update no longer matches the verified release")
	}
	if err := verifyBinary(staged, next); err != nil {
		return err
	}
	if err := replaceManagedBinary(target, staged, next, false); err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "XBond %s is installed.\n", next)
	return reportMachineUpgrade(cmd, target, next)
}

func waitForParent(pid uint32) error {
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, pid)
	if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
		return nil // The short-lived CLI already exited.
	}
	if err != nil {
		return fmt.Errorf("open the parent process: %w", err)
	}
	defer windows.CloseHandle(handle)
	status, err := windows.WaitForSingleObject(handle, 30_000)
	if err != nil {
		return fmt.Errorf("wait for the parent process: %w", err)
	}
	if status != windows.WAIT_OBJECT_0 {
		return errors.New("the parent CLI did not exit before the upgrade deadline")
	}
	return nil
}
