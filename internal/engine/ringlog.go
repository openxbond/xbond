package engine

import (
	"strings"
	"sync"
	"time"

	slog "github.com/sagernet/sing-box/log"
)

type LogLevel string

const (
	LogLevelDebug LogLevel = "debug"
	LogLevelInfo  LogLevel = "info"
	LogLevelWarn  LogLevel = "warn"
	LogLevelError LogLevel = "error"
)

type LogEntry struct {
	// Seq is a daemon-lifetime monotonic counter. `logs --follow` uses it as
	// a cursor: the ring buffer wraps, so array length says nothing about
	// which entries are new.
	Seq       uint64    `json:"seq"`
	Timestamp time.Time `json:"timestamp"`
	Level     LogLevel  `json:"level"`
	Message   string    `json:"message"`
}

type RingLogger struct {
	mu       sync.RWMutex
	capacity int
	entries  []LogEntry
	cursor   int
	isFull   bool
	seq      uint64
}

func NewRingLogger(capacity int) *RingLogger {
	if capacity <= 0 {
		capacity = 500
	}
	return &RingLogger{
		capacity: capacity,
		entries:  make([]LogEntry, capacity),
	}
}

func (r *RingLogger) Write(p []byte) (n int, err error) {
	msg := strings.TrimSpace(string(p))
	if msg == "" {
		return len(p), nil
	}

	level := LogLevelInfo
	lower := strings.ToLower(msg)
	switch {
	case strings.Contains(lower, "error") || strings.Contains(lower, "fatal") || strings.Contains(lower, "panic"):
		level = LogLevelError
	case strings.Contains(lower, "warn"):
		level = LogLevelWarn
	case strings.Contains(lower, "debug"):
		level = LogLevelDebug
	}

	r.Append(level, msg)
	return len(p), nil
}

func (r *RingLogger) WriteMessage(level slog.Level, message string) {
	var l LogLevel
	switch level {
	case slog.LevelDebug, slog.LevelTrace:
		l = LogLevelDebug
	case slog.LevelInfo:
		l = LogLevelInfo
	case slog.LevelWarn:
		l = LogLevelWarn
	case slog.LevelError, slog.LevelFatal, slog.LevelPanic:
		l = LogLevelError
	default:
		l = LogLevelInfo
	}
	r.Append(l, message)
}

func (r *RingLogger) Append(level LogLevel, msg string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.seq++
	r.entries[r.cursor] = LogEntry{
		Seq:       r.seq,
		Timestamp: time.Now(),
		Level:     level,
		Message:   msg,
	}
	r.cursor++
	if r.cursor >= r.capacity {
		r.cursor = 0
		r.isFull = true
	}
}

func (r *RingLogger) Snapshot(minLevel LogLevel, limit int) []LogEntry {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var total int
	if r.isFull {
		total = r.capacity
	} else {
		total = r.cursor
	}

	raw := make([]LogEntry, 0, total)
	if r.isFull {
		raw = append(raw, r.entries[r.cursor:]...)
		raw = append(raw, r.entries[:r.cursor]...)
	} else {
		raw = append(raw, r.entries[:r.cursor]...)
	}

	filtered := make([]LogEntry, 0, len(raw))
	for _, entry := range raw {
		if shouldInclude(entry.Level, minLevel) {
			filtered = append(filtered, entry)
		}
	}

	if limit > 0 && len(filtered) > limit {
		filtered = filtered[len(filtered)-limit:]
	}
	return filtered
}

func shouldInclude(level, minLevel LogLevel) bool {
	if minLevel == "" {
		return true
	}
	order := map[LogLevel]int{
		LogLevelDebug: 1,
		LogLevelInfo:  2,
		LogLevelWarn:  3,
		LogLevelError: 4,
	}
	return order[level] >= order[minLevel]
}
