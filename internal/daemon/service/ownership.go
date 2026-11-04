package service

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// UserRegistration identifies only registrations that XBond would generate
// for this executable. Modified or external supervisor configuration is left
// to its owner.
func UserRegistration(exe string) (registered, owned bool, err error) {
	return userRegistration(exe)
}

func checkRegistration(path, expected string) (registered, owned bool, err error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	return true, strings.ReplaceAll(string(data), "\r\n", "\n") == expected, nil
}

// SystemRegistration reports a machine registration that points to this
// executable. It is separate from the user service and has its own lifecycle.
func SystemRegistration(exe string) (registered, owned bool, err error) {
	return systemRegistration(exe)
}

func sameRegisteredExecutable(path, target string) bool {
	if !filepath.IsAbs(path) {
		return false
	}
	if path == target || (runtime.GOOS == "windows" && strings.EqualFold(path, target)) {
		return true
	}
	candidate, err := os.Stat(path)
	if err != nil {
		return false
	}
	expected, err := os.Stat(target)
	return err == nil && os.SameFile(candidate, expected)
}

const machineOwnerFile = "install-owner"

func machineOwner(exe string) (string, error) {
	path, err := filepath.EvalSymlinks(exe)
	if err != nil {
		return "", err
	}
	path, err = filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if runtime.GOOS == "windows" {
		path = strings.ToLower(path)
	}
	digest := sha256.Sum256([]byte(path))
	return hex.EncodeToString(digest[:]), nil
}
