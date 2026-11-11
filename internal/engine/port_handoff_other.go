//go:build !darwin || ios

package engine

func (*Manager) prepareListenerHandoff(int) error { return nil }
