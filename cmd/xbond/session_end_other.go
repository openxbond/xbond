//go:build !windows

package main

func watchSessionEnd() (<-chan struct{}, func()) {
	return nil, func() {}
}
