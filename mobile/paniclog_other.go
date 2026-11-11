//go:build !linux

package mobile

// redirectPanicLog is the no-op stub for non-linux platforms; the fd-2
// redirect only applies to the Android runtime (see paniclog_linux.go).
func redirectPanicLog() {}
