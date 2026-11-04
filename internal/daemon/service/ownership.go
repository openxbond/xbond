package service

import (
	"errors"
	"os"
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
