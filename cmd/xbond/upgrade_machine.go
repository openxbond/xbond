package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/openxbond/xbond/internal/daemon"
	"github.com/openxbond/xbond/internal/daemon/service"
	"github.com/openxbond/xbond/internal/upgrade"
	"github.com/openxbond/xbond/internal/version"
	"github.com/spf13/cobra"
)

func init() {
	daemonCmd.AddCommand(&cobra.Command{
		Use:    "system-upgrade <owner> <version>",
		Hidden: true,
		Args:   cobra.ExactArgs(2),
		RunE:   runMachineUpgrade,
	})
}

func pendingMachineUpgrade(origin, next string) (*service.MachineInstallation, error) {
	machine, err := service.MachineInstallationFor(origin)
	if err != nil || machine == nil {
		return machine, err
	}
	current, err := installedVersion(machine.Binary)
	if err != nil {
		return nil, err
	}
	have, err := upgrade.VersionCode(current)
	if err != nil {
		return nil, err
	}
	want, err := upgrade.VersionCode(next)
	if err != nil {
		return nil, err
	}
	if want < have {
		return nil, nil
	}
	if want == have {
		if samePath(machine.Binary, machine.Updater) {
			return nil, nil
		}
		helper, err := installedVersion(machine.Updater)
		if err != nil {
			return nil, err
		}
		helperCode, err := upgrade.VersionCode(helper)
		if err != nil || helperCode >= want {
			return nil, err
		}
	}
	return machine, nil
}

func upgradeMachineFor(origin, next string) (bool, error) {
	machine, err := pendingMachineUpgrade(origin, next)
	if err != nil || machine == nil {
		return false, err
	}
	if err := machine.ElevateUpgrade(origin, next); err != nil {
		return false, err
	}
	if err := verifyBinary(machine.Binary, next); err != nil {
		return false, err
	}
	pending, err := pendingMachineUpgrade(origin, next)
	if err != nil {
		return false, err
	}
	if pending != nil {
		return false, errors.New("the machine updater did not activate the new release")
	}
	return true, nil
}

func runMachineUpgrade(cmd *cobra.Command, args []string) error {
	origin, next := args[0], args[1]
	admin, err := service.IsMachineAdministrator()
	if err != nil {
		return err
	}
	if !admin || version.ReleasePublicKey == "" {
		return errors.New("machine upgrades require the authorized system updater")
	}
	machine, err := service.MachineInstallationFor(origin)
	if err != nil {
		return err
	}
	if machine == nil {
		return errors.New("the system registration is not owned by this installation")
	}
	self, err := executablePath()
	if err != nil {
		return err
	}
	if !samePath(self, machine.Updater) {
		return errors.New("machine upgrades must run from the protected updater")
	}
	unlock, err := upgrade.Lock(filepath.Dir(machine.Binary))
	if err != nil {
		return err
	}
	defer unlock()
	machine, err = pendingMachineUpgrade(origin, next)
	if err != nil {
		return err
	}
	if machine == nil {
		return errors.New("machine ownership or version changed before the update")
	}
	if err := machine.VerifyStateDirectory(); err != nil {
		return err
	}
	if err := os.Setenv("XBOND_DATA_DIR", machine.DataDir); err != nil {
		return err
	}
	release, err := upgrade.Fetch(cmd.Context(), version.ReleasePublicKey)
	if err != nil {
		return err
	}
	if release.Version != next {
		return fmt.Errorf("the verified feed currently offers %s, not %s", release.Version, next)
	}
	asset, err := release.CLI()
	if err != nil {
		return err
	}
	staged, err := asset.Download(cmd.Context(), filepath.Dir(machine.Binary))
	if err != nil {
		return err
	}
	defer os.Remove(staged)
	if err := verifyBinary(staged, next); err != nil {
		return err
	}
	if err := machine.ProtectCandidate(staged); err != nil {
		return err
	}
	activateUpdater, err := machine.PrepareUpdater(staged)
	if err != nil {
		return fmt.Errorf("stage the next machine updater: %w", err)
	}
	old, err := installedVersion(machine.Binary)
	if err != nil {
		return err
	}
	oldCode, err := upgrade.VersionCode(old)
	if err != nil {
		return err
	}
	if oldCode < release.Build {
		if err := replaceMachineBinary(*machine, staged, old, next); err != nil {
			return err
		}
	}
	if err := activateUpdater(); err != nil {
		return fmt.Errorf("the machine daemon is at %s, but its updater could not be activated: %w", next, err)
	}
	return nil
}

func machineStopped(state string) bool {
	switch state {
	case "stopped", "installed, not running", "installed, inactive", "installed, failed":
		return true
	}
	return false
}

func machineRunning(state string) bool { return state == "running" }

func waitMachineSupervisor(timeout time.Duration, accepts func(string) bool) error {
	deadline := time.Now().Add(timeout)
	for {
		state, err := service.SystemStatus()
		if err != nil {
			return err
		}
		if accepts(state) {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("machine service did not reach the requested state (last state: %s)", state)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func stopMachineDaemon(binary string) error {
	state, err := service.SystemStatus()
	if err != nil {
		return err
	}
	if !machineStopped(state) {
		if err := service.StopScope(service.ScopeSystem, binary); err != nil {
			return err
		}
	}
	if err := waitMachineSupervisor(10*time.Second, machineStopped); err != nil {
		return err
	}
	return waitDaemonExit(5 * time.Second)
}

func startMachineDaemon(binary, version string) error {
	if err := service.StartScope(service.ScopeSystem, binary); err != nil {
		return err
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		if _, _, err := runningDaemon(binary, version); err == nil {
			return nil
		} else if time.Now().After(deadline) {
			return fmt.Errorf("machine daemon %s did not become healthy: %w", version, err)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func replaceMachineBinary(machine service.MachineInstallation, staged, old, next string) error {
	state, err := service.SystemStatus()
	if err != nil {
		return err
	}
	running := state == "running"
	if !running && !machineStopped(state) {
		return fmt.Errorf("the machine daemon is changing state (%s); retry once it is settled", state)
	}
	held, err := daemon.InstanceLockHeld(machine.DataDir)
	if err != nil {
		return err
	}
	if running != held {
		return errors.New("the machine supervisor state and daemon lock disagree")
	}
	if running {
		if _, _, err := runningDaemon(machine.Binary, old); err != nil {
			return err
		}
	}

	backup, err := upgrade.Copy(filepath.Dir(machine.Binary), machine.Binary)
	if err != nil {
		return err
	}
	keepBackup := false
	defer func() {
		if !keepBackup {
			_ = os.Remove(backup)
		}
	}()
	if err := machine.ProtectCandidate(backup); err != nil {
		return err
	}
	if running {
		if err := stopMachineDaemon(machine.Binary); err != nil {
			if current, probeErr := service.SystemStatus(); probeErr == nil && machineStopped(current) {
				err = errors.Join(err, startMachineDaemon(machine.Binary, old))
			}
			return fmt.Errorf("stop the machine daemon before replacement: %w", err)
		}
	}
	if err := renameUpgradeBinary(staged, machine.Binary); err != nil {
		if running {
			err = errors.Join(err, startMachineDaemon(machine.Binary, old))
		}
		return err
	}
	if !running {
		return nil
	}
	if err := startMachineDaemon(machine.Binary, next); err != nil {
		restored, rollbackErr := rollbackMachineBinary(machine.Binary, backup,
			func() error { return stopMachineDaemon(machine.Binary) },
			func() error { return startMachineDaemon(machine.Binary, old) })
		keepBackup = !restored
		if rollbackErr != nil {
			return errors.Join(err, rollbackErr)
		}
		return fmt.Errorf("the replacement failed its health check; restored the previous machine daemon: %w", err)
	}
	return nil
}

func rollbackMachineBinary(binary, backup string, stop, start func() error) (bool, error) {
	if err := stop(); err != nil {
		return false, fmt.Errorf("cannot stop the replacement, previous binary kept at %s: %w", backup, err)
	}
	if err := renameUpgradeBinary(backup, binary); err != nil {
		return false, fmt.Errorf("cannot restore the previous binary at %s: %w", backup, err)
	}
	if err := start(); err != nil {
		return true, fmt.Errorf("could not restart the restored machine daemon: %w", err)
	}
	return true, nil
}
