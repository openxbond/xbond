package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// MachineInstallation contains only the fixed, administrator-owned paths
// from a machine service installed by the same standalone or desktop binary.
type MachineInstallation struct {
	Binary  string
	DataDir string
	Updater string
}

func MachineInstallationFor(origin string) (*MachineInstallation, error) {
	installation, err := machinePaths()
	if err != nil {
		return nil, err
	}
	managed, err := machineRegistrationMatches(installation)
	if err != nil || !managed {
		return nil, err
	}
	if err := validateMachineDirectory(filepath.Dir(installation.Binary)); err != nil {
		return nil, err
	}
	ownerPath := filepath.Join(filepath.Dir(installation.Binary), machineOwnerFile)
	if err := validateMachineFile(ownerPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	owner, err := os.ReadFile(ownerPath)
	if err != nil {
		return nil, err
	}
	expected, err := machineOwner(origin)
	if err != nil {
		return nil, err
	}
	if string(owner) != expected {
		return nil, nil
	}
	installation.Updater, err = resolveMachineUpdater(installation)
	if err != nil {
		return nil, err
	}
	for _, file := range []string{installation.Binary, installation.Updater} {
		if err := validateMachineFile(file); err != nil {
			return nil, fmt.Errorf("verify machine installation: %w", err)
		}
	}
	return &installation, nil
}

// ElevateUpgrade runs a protected executable with native elevation. The
// elevated side rechecks the registration, owner and signed release feed.
func (m MachineInstallation) ElevateUpgrade(origin, version string) error {
	if strings.ContainsRune(origin, '\x00') {
		return errors.New("invalid machine installation origin")
	}
	return elevateMachineUpgrade(m.Updater, origin, version)
}

func IsMachineAdministrator() (bool, error) {
	return isMachineAdministrator()
}

func (m MachineInstallation) VerifyStateDirectory() error {
	return validateMachineStateDirectory(m.DataDir)
}

func (m MachineInstallation) ProtectCandidate(path string) error {
	if filepath.Dir(path) != filepath.Dir(m.Binary) {
		return errors.New("machine candidate must be beside the installed binary")
	}
	return protectMachineCandidate(path)
}

// PrepareUpdater stages any separate helper before the daemon replacement.
// ActivateUpdater is called only once the replacement has been verified.
func (m MachineInstallation) PrepareUpdater(candidate string) (func() error, error) {
	return prepareMachineUpdater(m, candidate)
}
