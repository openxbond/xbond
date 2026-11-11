//go:build darwin && !ios

package engine

import (
	"net"
	"testing"

	"golang.org/x/sys/unix"
)

func TestPortHandoffAppliesToAcceptedConnections(t *testing.T) {
	listener, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	manager := NewManager(10)
	manager.EnablePortHandoff()
	if err := manager.prepareListenerHandoff(listener.Addr().(*net.TCPAddr).Port); err != nil {
		t.Fatal(err)
	}
	client, err := net.Dial("tcp4", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	conn, err := listener.AcceptTCP()
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	raw, err := conn.SyscallConn()
	if err != nil {
		t.Fatal(err)
	}
	var enabled int
	var optionErr error
	if err := raw.Control(func(fd uintptr) {
		enabled, optionErr = unix.GetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_REUSESHAREUID)
	}); err != nil {
		t.Fatal(err)
	}
	if optionErr != nil || enabled == 0 {
		t.Fatalf("accepted socket did not inherit SO_REUSESHAREUID: value=%d, error=%v", enabled, optionErr)
	}
}
