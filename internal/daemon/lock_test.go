package daemon

import "testing"

func TestInstanceLockRejectsSecondAcquireAndSurvivesRelease(t *testing.T) {
	dir := t.TempDir()

	first, err := acquireInstanceLock(dir)
	if err != nil {
		t.Fatalf("first acquire failed: %v", err)
	}

	second, err := acquireInstanceLock(dir)
	if err == nil {
		second.Release()
		t.Fatal("second acquire must fail while the first instance holds the lock")
	}

	first.Release()

	third, err := acquireInstanceLock(dir)
	if err != nil {
		t.Fatalf("re-acquire after release failed: %v", err)
	}
	third.Release()
}
