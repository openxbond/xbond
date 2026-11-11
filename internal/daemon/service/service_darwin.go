//go:build darwin

package service

import (
	"encoding/xml"
	"errors"
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
	target := guiTarget() + "/" + darwinLabel
	if err := run("launchctl", "print", target); err == nil {
		return run("launchctl", "kickstart", target)
	}
	plistPath, err := agentPlistPath()
	if err != nil {
		return err
	}
	// A graceful stop unloads the job. Bootstrap loads and starts RunAtLoad.
	return run("launchctl", "bootstrap", guiTarget(), plistPath)
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
