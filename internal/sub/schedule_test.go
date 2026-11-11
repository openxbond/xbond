package sub

import (
	"os"
	"testing"

	"github.com/openxbond/xbond/internal/platform/paths"
)

func TestUpdateScheduleRejectsInvalidValuesAndRollsBackFailedWrite(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	m, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	meta, err := m.AddUniversal("https://example.invalid/config", "schedule", 24, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.SetUpdateSchedule(meta.ID, 5); err == nil {
		t.Fatal("unsupported interval accepted")
	}
	if err := m.SetUpdateSchedule("missing", 12); err == nil {
		t.Fatal("missing subscription accepted")
	}
	if err := os.Remove(paths.SubListPath()); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(paths.SubListPath(), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := m.SetUpdateSchedule(meta.ID, 0); err == nil {
		t.Fatal("failed write reported success")
	}
	saved, err := m.Get(meta.ID)
	if err != nil || !saved.AutoUpdate || saved.UpdateIntervalHours != 24 || saved.UpdateIntervalCustomized {
		t.Fatal("failed write changed the live schedule")
	}
}
