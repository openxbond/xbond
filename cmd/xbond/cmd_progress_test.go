package main

import (
	"strings"
	"testing"
)

func TestRenderFetchProgressLineDeterminate(t *testing.T) {
	line := renderFetchProgressLine("/", 720_896, 2_622_094)
	for _, want := range []string{
		"downloading config [",
		strings.Repeat("=", 7) + ">",
		"27%",
		"704 KB",
		"2.5 MB",
	} {
		if !strings.Contains(line, want) {
			t.Fatalf("line %q missing %q", line, want)
		}
	}
}

func TestRenderFetchProgressLineComplete(t *testing.T) {
	line := renderFetchProgressLine("|", 2_622_094, 2_622_094)
	if !strings.Contains(line, "["+strings.Repeat("=", 28)+"]") {
		t.Fatalf("full bar missing: %q", line)
	}
	if !strings.Contains(line, "100%") {
		t.Fatalf("percent missing: %q", line)
	}
}

func TestRenderFetchProgressLineUnknownTotal(t *testing.T) {
	line := renderFetchProgressLine("\\", 5, 0)
	if !strings.Contains(line, "\\") || !strings.Contains(line, "5 B") {
		t.Fatalf("indeterminate line malformed: %q", line)
	}
	if strings.Contains(line, "%") {
		t.Fatalf("unknown total must not show a percentage: %q", line)
	}
}

func TestRenderFetchProgressLineClampsOverread(t *testing.T) {
	line := renderFetchProgressLine("|", 3_000_000, 2_622_094)
	if !strings.Contains(line, "100%") {
		t.Fatalf("overread must clamp to 100%%: %q", line)
	}
}

func TestFormatProgressBytes(t *testing.T) {
	cases := map[int64]string{
		0:         "0 B",
		5:         "5 B",
		1024:      "1 KB",
		720_896:   "704 KB",
		2_622_094: "2.5 MB",
	}
	for input, want := range cases {
		if got := formatProgressBytes(input); got != want {
			t.Fatalf("formatProgressBytes(%d) = %q, want %q", input, got, want)
		}
	}
}
