//go:build darwin

package service

import (
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

func agentPlistPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to resolve home directory: %w", err)
	}
	return filepath.Join(home, "Library", "LaunchAgents", darwinLabel+".plist"), nil
}

func guiTarget() string {
	return "gui/" + strconv.Itoa(os.Getuid())
}

func installDaemon(exePath string) error {
	plistPath, err := agentPlistPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(plistPath), 0o755); err != nil {
		return fmt.Errorf("failed to create LaunchAgents directory: %w", err)
	}
	if err := os.WriteFile(plistPath, []byte(LaunchAgentPlistContent(exePath)), 0o644); err != nil {
		return fmt.Errorf("failed to write LaunchAgent plist: %w", err)
	}
	// bootstrap registers the agent with the user's GUI domain; RunAtLoad
	// starts it immediately. "Already bootstrapped" cannot be treated as
	// success: the loaded definition may be stale — an earlier install's
	// program path (the app has since been replaced or removed), which
	// launchd then keeps spawning into EX_CONFIG while the fresh plist on
	// disk never loads. Unload the stale job and bootstrap the new plist.
	if err := run("launchctl", "bootstrap", guiTarget(), plistPath); err != nil {
		if !strings.Contains(err.Error(), "already bootstrapped") {
			return err
		}
		if err := run("launchctl", "bootout", guiTarget()+"/"+darwinLabel); err != nil {
			return fmt.Errorf("failed to unload the stale agent: %w", err)
		}
		if err := run("launchctl", "bootstrap", guiTarget(), plistPath); err != nil {
			return fmt.Errorf("failed to bootstrap the refreshed agent: %w", err)
		}
	}
	return nil
}

func uninstallDaemon() error {
	plistPath, err := agentPlistPath()
	if err != nil {
		return err
	}
	// Tolerate an unloaded agent: uninstall must converge on "not installed".
	_ = run("launchctl", "bootout", guiTarget()+"/"+darwinLabel)
	if err := os.Remove(plistPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove LaunchAgent plist: %w", err)
	}
	return nil
}

func startDaemon() error {
	target := guiTarget() + "/" + darwinLabel
	if err := run("launchctl", "print", target); err == nil {
		// The loaded definition may predate the current install: an app
		// replacement or removal leaves launchd spawning the recorded program
		// path (EX_CONFIG when it is gone). When it differs from the running
		// CLI, reinstall from it — bootout unloads the stale job and the fresh
		// plist bootstraps with RunAtLoad.
		if program, err := loadedAgentProgram(target); err == nil && program != "" {
			if self, err := SelfPath(); err == nil && program != self {
				return installDaemon(self)
			}
		}
		return run("launchctl", "kickstart", target)
	}
	plistPath, err := agentPlistPath()
	if err != nil {
		return err
	}
	// A graceful stop unloads the job. Bootstrap loads and starts RunAtLoad.
	return run("launchctl", "bootstrap", guiTarget(), plistPath)
}

// loadedAgentProgram reads the program path of the job launchd currently has
// loaded — not the plist on disk, which an install may have rewritten while
// the stale definition stayed loaded.
func loadedAgentProgram(target string) (string, error) {
	out, err := exec.Command("launchctl", "print", target).CombinedOutput()
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(out), "\n") {
		if program, ok := strings.CutPrefix(strings.TrimSpace(line), "program = "); ok {
			return strings.Trim(program, `"`), nil
		}
	}
	return "", fmt.Errorf("job %s does not report a program path", target)
}

func stopDaemon() error {
	return run("launchctl", "bootout", guiTarget()+"/"+darwinLabel)
}

func daemonInstalled() bool {
	plistPath, err := agentPlistPath()
	if err != nil {
		return false
	}
	_, err = os.Stat(plistPath)
	return err == nil
}

func userRegistration(exe string) (bool, bool, error) {
	plistPath, err := agentPlistPath()
	if err != nil {
		return false, false, err
	}
	return checkRegistration(plistPath, LaunchAgentPlistContent(exe))
}

func systemRegistration(exe string) (bool, bool, error) {
	config, err := os.ReadFile(darwinSystemPlist)
	if errors.Is(err, os.ErrNotExist) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	var plist struct {
		Args []string `xml:"dict>array>string"`
	}
	if err := xml.Unmarshal(config, &plist); err != nil {
		return true, false, fmt.Errorf("read machine launch arguments: %w", err)
	}
	for _, arg := range plist.Args {
		if sameRegisteredExecutable(arg, exe) {
			return true, true, nil
		}
	}
	return true, false, nil
}
