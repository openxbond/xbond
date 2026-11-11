package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/openxbond/xbond/internal/daemon"
	"github.com/openxbond/xbond/internal/daemon/service"
	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/upgrade"
	"github.com/openxbond/xbond/internal/version"
)

type daemonIdentity struct {
	Executable string
	Version    string
	TokenHash  [sha256.Size]byte
}

func identityPath() string {
	return filepath.Join(paths.DataDir(), "daemon-identity.json")
}

// Bind the executable identity to the live LocalAPI credentials. A crashed
// process can leave this file behind, but its stale token is never accepted
// as evidence for a later instance.
func recordDaemonIdentity(server *daemon.Server) error {
	exe, err := executablePath()
	if err != nil {
		return err
	}
	data, err := json.Marshal(daemonIdentity{
		Executable: exe,
		Version:    version.Version,
		TokenHash:  sha256.Sum256([]byte(server.Token())),
	})
	if err != nil {
		return err
	}
	return atomicfile.Write(identityPath(), data, 0o600)
}

func readDaemonIdentity() (daemonIdentity, error) {
	var identity daemonIdentity
	data, err := os.ReadFile(identityPath())
	if err != nil {
		return identity, err
	}
	if err := json.Unmarshal(data, &identity); err != nil {
		return identity, err
	}
	token, err := os.ReadFile(paths.LocalAPITokenPath())
	if err != nil {
		return identity, err
	}
	if sha256.Sum256(token) != identity.TokenHash {
		return identity, errors.New("daemon credentials changed")
	}
	return identity, nil
}

func runningDaemon(exe, version string) (*daemon.Client, *daemon.StatusResponse, error) {
	identity, err := readDaemonIdentity()
	if err != nil {
		return nil, nil, fmt.Errorf("could not identify the running daemon: %w", err)
	}
	if !samePath(identity.Executable, exe) || identity.Version != version {
		return nil, nil, errors.New("the running daemon belongs to a different executable or version")
	}
	client, err := daemon.NewClient()
	if err != nil {
		return nil, nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	status, err := client.GetStatusLight(ctx)
	if err != nil {
		return nil, nil, err
	}
	if live, err := readDaemonIdentity(); err != nil || live != identity {
		return nil, nil, errors.New("the running daemon changed during verification")
	}
	return client, status, nil
}

func stopManagedDaemon(exe, version string) error {
	held, err := daemon.InstanceLockHeld(paths.DataDir())
	if err != nil || !held {
		return err
	}
	client, _, err := runningDaemon(exe, version)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result, err := client.Shutdown(ctx)
	if err != nil {
		return err
	}
	if err := waitDaemonExit(5 * time.Second); err != nil {
		return err
	}
	if !result.CleanedUp {
		return fmt.Errorf("daemon reported incomplete cleanup: %s", result.Error)
	}
	return nil
}

func startManagedDaemon(exe, version string, previous *daemon.StatusResponse, install bool) error {
	if install {
		if err := service.Install(exe, service.ScopeUser); err != nil {
			return err
		}
	} else {
		_, owned, err := service.UserRegistration(exe)
		if err != nil {
			return err
		}
		if !owned {
			return errors.New("the daemon registration changed during the update")
		}
		if err := service.Start(); err != nil {
			return err
		}
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		client, status, err := runningDaemon(exe, version)
		if err == nil {
			if previous == nil || !previous.Engine.Running || status.Engine.Running {
				return nil
			}
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			return client.Up(ctx, "", "", nil, nil, "")
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("daemon %s did not become healthy: %w", version, err)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// replaceManagedBinary is called with the update lock held and after the
// caller has authenticated and staged the candidate on the target volume.
func replaceManagedBinary(target, staged, next string, install bool) error {
	registered, owned, err := service.UserRegistration(target)
	if err != nil {
		return err
	}
	if install && registered {
		return errors.New("a daemon registration appeared while staging the update")
	}
	if err := ensureNoMachineOwner(target); err != nil {
		return err
	}

	oldVersion, err := installedVersion(target)
	if err != nil && !(install && errors.Is(err, os.ErrNotExist)) {
		return err
	}
	if oldVersion != "" {
		current, err := upgrade.VersionCode(oldVersion)
		if err != nil {
			return err
		}
		newCode, err := upgrade.VersionCode(next)
		if err != nil {
			return err
		}
		if current >= newCode && !install {
			return nil
		}
		if current > newCode {
			return errors.New("refusing to downgrade an installed daemon")
		}
	}

	held, err := daemon.InstanceLockHeld(paths.DataDir())
	if err != nil {
		return err
	}
	var previous *daemon.StatusResponse
	if held {
		if owned {
			_, previous, err = runningDaemon(target, oldVersion)
			if err != nil {
				return err
			}
		} else {
			identity, err := readDaemonIdentity()
			if err != nil {
				return fmt.Errorf("could not determine whether a running daemon uses this binary: %w", err)
			}
			if samePath(identity.Executable, target) || install {
				return errors.New("the running daemon is not owned by this installation; stop it before updating")
			}
		}
	}

	var backup string
	if oldVersion != "" {
		info, err := os.Stat(target)
		if err != nil {
			return err
		}
		if err := os.Chmod(staged, info.Mode().Perm()); err != nil {
			return fmt.Errorf("preserve installed executable permissions: %w", err)
		}
		backup, err = upgrade.Copy(filepath.Dir(target), target)
		if err != nil {
			return fmt.Errorf("backup the installed binary: %w", err)
		}
		defer func() {
			if backup != "" {
				_ = os.Remove(backup)
			}
		}()
		if err := os.Chmod(backup, info.Mode().Perm()); err != nil {
			return fmt.Errorf("preserve backup executable permissions: %w", err)
		}
	}

	if previous != nil {
		if err := stopManagedDaemon(target, oldVersion); err != nil {
			if held, probe := daemon.InstanceLockHeld(paths.DataDir()); probe == nil && !held {
				err = errors.Join(err, startManagedDaemon(target, oldVersion, previous, false))
			}
			return fmt.Errorf("stop managed daemon before replacement: %w", err)
		}
	}
	if err := renameUpgradeBinary(staged, target); err != nil {
		if previous != nil {
			err = errors.Join(err, startManagedDaemon(target, oldVersion, previous, false))
		}
		return fmt.Errorf("replace installed executable: %w", err)
	}

	if previous == nil && !install {
		return nil
	}
	if err := startManagedDaemon(target, next, previous, install); err != nil {
		rollback := func() error {
			if err := stopManagedDaemon(target, next); err != nil {
				return err
			}
			if install {
				if err := service.Uninstall(); err != nil {
					return err
				}
			}
			if backup == "" {
				return os.Remove(target)
			}
			if err := renameUpgradeBinary(backup, target); err != nil {
				return err
			}
			backup = ""
			if previous != nil {
				return startManagedDaemon(target, oldVersion, previous, false)
			}
			return nil
		}()
		if rollback != nil {
			if backup != "" {
				saved := backup
				backup = ""
				rollback = fmt.Errorf("%w (previous binary kept at %s)", rollback, saved)
			}
			return errors.Join(err, fmt.Errorf("rollback failed: %w", rollback))
		}
		return fmt.Errorf("daemon failed to start; restored the previous installation: %w", err)
	}
	return nil
}
