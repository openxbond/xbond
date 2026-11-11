package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestMachineRollbackRestartsThePreviousBinary(t *testing.T) {
	dir := t.TempDir()
	binary := filepath.Join(dir, "xbond")
	backup := filepath.Join(dir, "xbond-backup")
	if err := os.WriteFile(binary, []byte("replacement"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(backup, []byte("previous"), 0o755); err != nil {
		t.Fatal(err)
	}
	check := func(path, want string) {
		t.Helper()
		data, err := os.ReadFile(path)
		if err != nil || string(data) != want {
			t.Fatalf("%s = %q, %v, want %q", path, data, err, want)
		}
	}
	denied := errors.New("service cannot stop")
	restored, err := rollbackMachineBinary(binary, backup,
		func() error { return denied },
		func() error { t.Fatal("started without stopping the replacement"); return nil })
	if restored || !errors.Is(err, denied) {
		t.Fatalf("unsafe rollback result: restored=%v error=%v", restored, err)
	}
	check(binary, "replacement")
	check(backup, "previous")

	restored, err = rollbackMachineBinary(binary, backup, func() error {
		check(binary, "replacement")
		return nil
	}, func() error {
		check(binary, "previous")
		return nil
	})
	if !restored || err != nil {
		t.Fatalf("rollback did not restore and start: restored=%v error=%v", restored, err)
	}
}
