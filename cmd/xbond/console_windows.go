//go:build windows

package main

import "syscall"

// hideConsoleWindow removes the console the Windows Run-key launch opens at
// logon; the daemon's output is diagnostics-only, and a stray terminal at
// every login is hostile. No-op when there is no console (a foreground
// `xbond daemon` run from an existing terminal keeps its window).
func hideConsoleWindow() {
	getConsoleWindow := syscall.NewLazyDLL("kernel32.dll").NewProc("GetConsoleWindow")
	showWindow := syscall.NewLazyDLL("user32.dll").NewProc("ShowWindow")

	const swHide = 0
	if hwnd, _, _ := getConsoleWindow.Call(); hwnd != 0 {
		_, _, _ = showWindow.Call(hwnd, swHide)
	}
}
