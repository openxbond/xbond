package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"unsafe"

	"github.com/openxbond/xbond/internal/upgrade"
	"golang.org/x/sys/windows"
)

const (
	machineDirectoryACL = "O:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)"
	machinePublicDirACL = machineDirectoryACL + "(A;OICI;FRFX;;;BU)"
	machineFileACL      = "O:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FRFX;;;BU)"
	updaterSlotFile     = "active-updater"
)

func machinePaths() (MachineInstallation, error) {
	dir, err := machineWindowsDirectory()
	if err != nil {
		return MachineInstallation{}, err
	}
	return MachineInstallation{
		Binary:  filepath.Join(dir, "xbond.exe"),
		DataDir: filepath.Join(dir, "state"),
	}, nil
}

func machineWindowsDirectory() (string, error) {
	dir, err := windows.KnownFolderPath(windows.FOLDERID_ProgramFiles, 0)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "XBond Machine"), nil
}

func ensureMachineDirectory(path, acl string) error {
	want, err := windows.SecurityDescriptorFromString(acl)
	if err != nil {
		return err
	}
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	err = windows.CreateDirectory(name, &windows.SecurityAttributes{
		Length:             uint32(unsafe.Sizeof(windows.SecurityAttributes{})),
		SecurityDescriptor: want,
	})
	if err != nil && !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		return err
	}
	return validateMachineWindowsPath(path, acl, true)
}

func validateMachineDirectory(path string) error {
	return validateMachineWindowsPath(path, machinePublicDirACL, true)
}

func validateMachineStateDirectory(path string) error {
	return validateMachineWindowsPath(path, machineDirectoryACL, true)
}

func validateMachineFile(path string) error {
	return validateMachineWindowsPath(path, machineFileACL, false)
}

func validateMachineWindowsPath(path, acl string, directory bool) error {
	want, err := windows.SecurityDescriptorFromString(acl)
	if err != nil {
		return err
	}
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	attributes, err := windows.GetFileAttributes(name)
	if err != nil {
		return err
	}
	if (attributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0) != directory || attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return fmt.Errorf("invalid machine path: %s", path)
	}
	actual, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return err
	}
	if actual.String() == "" || actual.String() != want.String() {
		return fmt.Errorf("unexpected ownership or access rules for machine path: %s", path)
	}
	return nil
}

func protectMachineCandidate(path string) error {
	sd, err := windows.SecurityDescriptorFromString(machineFileACL)
	if err != nil {
		return err
	}
	owner, _, err := sd.Owner()
	if err != nil {
		return err
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		return err
	}
	if err := windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		owner, nil, dacl, nil); err != nil {
		return err
	}
	return validateMachineFile(path)
}

func installWindowsMachineFiles(source, dir string) (string, string, error) {
	stateDir := filepath.Join(dir, "state")
	if err := ensureMachineDirectory(stateDir, machineDirectoryACL); err != nil {
		return "", "", err
	}
	want, err := upgrade.Checksum(source)
	if err != nil {
		return "", "", err
	}
	target := filepath.Join(dir, "xbond.exe")
	for _, destination := range []string{target, machineUpdaterSlot(dir, "a")} {
		if err := copyMachineExecutable(source, destination, want); err != nil {
			return "", "", err
		}
	}
	owner, err := machineOwner(source)
	if err != nil {
		return "", "", err
	}
	ownerPath := filepath.Join(dir, machineOwnerFile)
	if err := writeMachineMetadata(ownerPath, owner); err != nil {
		return "", "", err
	}
	if err := setMachineUpdaterSlot(dir, "a"); err != nil {
		return "", "", err
	}
	return target, stateDir, nil
}

func machineUpdaterSlot(dir, slot string) string {
	return filepath.Join(dir, "xbond-upgrade-"+slot+".exe")
}

func setMachineUpdaterSlot(dir, slot string) error {
	return writeMachineMetadata(filepath.Join(dir, updaterSlotFile), slot)
}

func writeMachineMetadata(target, value string) error {
	staged, err := os.CreateTemp(filepath.Dir(target), ".metadata-*")
	if err != nil {
		return err
	}
	defer os.Remove(staged.Name())
	if _, err := staged.WriteString(value); err != nil {
		_ = staged.Close()
		return err
	}
	if err := staged.Sync(); err != nil {
		_ = staged.Close()
		return err
	}
	if err := staged.Close(); err != nil {
		return err
	}
	if err := protectMachineCandidate(staged.Name()); err != nil {
		return err
	}
	return os.Rename(staged.Name(), target)
}

func resolveMachineUpdater(installation MachineInstallation) (string, error) {
	dir := filepath.Dir(installation.Binary)
	selection := filepath.Join(dir, updaterSlotFile)
	if err := validateMachineFile(selection); err != nil {
		return "", err
	}
	slot, err := os.ReadFile(selection)
	if err != nil {
		return "", err
	}
	if string(slot) != "a" && string(slot) != "b" {
		return "", errors.New("invalid machine updater slot")
	}
	return machineUpdaterSlot(dir, string(slot)), nil
}

func prepareMachineUpdater(installation MachineInstallation, candidate string) (func() error, error) {
	dir := filepath.Dir(installation.Binary)
	slot := "a"
	if strings.EqualFold(installation.Updater, machineUpdaterSlot(dir, "a")) {
		slot = "b"
	}
	checksum, err := upgrade.Checksum(candidate)
	if err != nil {
		return nil, err
	}
	if err := copyMachineExecutable(candidate, machineUpdaterSlot(dir, slot), checksum); err != nil {
		return nil, err
	}
	return func() error { return setMachineUpdaterSlot(dir, slot) }, nil
}

func copyMachineExecutable(source, target, checksum string) error {
	staged, err := upgrade.Copy(filepath.Dir(target), source)
	if err != nil {
		return err
	}
	defer os.Remove(staged)
	got, err := upgrade.Checksum(staged)
	if err != nil {
		return err
	}
	if got != checksum {
		return errors.New("the source executable changed while installing the machine service")
	}
	if err := protectMachineCandidate(staged); err != nil {
		return err
	}
	return os.Rename(staged, target)
}

func isFixedWindowsMachineCommand(command, binary string) (bool, error) {
	args, err := windows.DecomposeCommandLine(command)
	if err != nil {
		return false, err
	}
	return len(args) > 0 && strings.EqualFold(filepath.Clean(args[0]), filepath.Clean(binary)) &&
		slices.Equal(args[1:], machineWindowsArguments(filepath.Join(filepath.Dir(binary), "state"))), nil
}

func machineWindowsArguments(stateDir string) []string {
	return []string{"daemon", "--service-run", "--listen", SystemListen, "--data-dir", stateDir}
}
