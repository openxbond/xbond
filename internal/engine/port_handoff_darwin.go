//go:build darwin && !ios

package engine

import (
	"fmt"
	"os"
	"strconv"

	"golang.org/x/sys/unix"
)

func (m *Manager) prepareListenerHandoff(port int) error {
	if !m.portHandoff {
		return nil
	}
	// The embedded cores own their listeners. Find the TCP listener for
	// this port before probing it. Accepted sockets inherit the option,
	// letting the user daemon bind after root's listener closes even while
	// those connections are still in TIME_WAIT.
	entries, err := os.ReadDir("/dev/fd")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		fd, err := strconv.Atoi(entry.Name())
		if err != nil || tcpListenerPort(fd) != port {
			continue
		}
		// Pin the socket while inspecting it so a concurrent close cannot
		// redirect setsockopt to a descriptor reused by another goroutine.
		socket, err := unix.FcntlInt(uintptr(fd), unix.F_DUPFD_CLOEXEC, 0)
		if err != nil {
			continue
		}
		found := tcpListenerPort(socket) == port
		if found {
			err = unix.SetsockoptInt(socket, unix.SOL_SOCKET, unix.SO_REUSESHAREUID, 1)
		}
		_ = unix.Close(socket)
		if found {
			if err != nil {
				return fmt.Errorf("prepare port %d for handoff: %w", port, err)
			}
			return nil
		}
	}
	return fmt.Errorf("TCP listener on port %d is not open in this process", port)
}

func tcpListenerPort(fd int) int {
	const tcpStateListen = 1 // TCPS_LISTEN in Darwin's netinet/tcp_fsm.h
	info, err := unix.GetsockoptTCPConnectionInfo(fd, unix.IPPROTO_TCP, unix.TCP_CONNECTION_INFO)
	if err != nil || info.State != tcpStateListen {
		return 0
	}
	addr, err := unix.Getsockname(fd)
	if err != nil {
		return 0
	}
	switch addr := addr.(type) {
	case *unix.SockaddrInet4:
		return addr.Port
	case *unix.SockaddrInet6:
		return addr.Port
	}
	return 0
}
