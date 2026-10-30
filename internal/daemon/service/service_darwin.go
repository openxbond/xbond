//go:build darwin

package service

import (
	"fmt"
	"os"
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
	// starts it immediately. A previous session's bootout already unloaded it.
	if err := run("launchctl", "bootstrap", guiTarget(), plistPath); err != nil {
		// Already bootstrapped means the agent is loaded; treat as success so
		// install stays idempotent.
		if !strings.Contains(err.Error(), "already bootstrapped") {
			return err
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
	// kickstart starts the job whether or not the GUI domain has it loaded
	// (it bootstraps from the plist on disk when needed).
	return run("launchctl", "kickstart", guiTarget()+"/"+darwinLabel)
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
