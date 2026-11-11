//go:build linux

package daemon

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/unix"

	"github.com/openxbond/xbond/internal/platform/paths"
)

// systemSocketPath is the unix socket the machine-scoped daemon serves its
// delegation endpoints on. /run keeps the socket world-traversable (the data
// dir is root-owned); admission happens per connection via SO_PEERCRED.
const systemSocketPath = "/run/xbond-daemon-system.sock"

// listenPrivileged opens the delegation transport for the machine-scoped
// daemon. Without a delegation grant (uid file) there is no caller identity
// to admit, so the transport stays closed: a delegating daemon then reports
// an honest "unreachable" instead of an anonymous backdoor.
func listenPrivileged() (net.Listener, error) {
	raw, err := os.ReadFile(paths.DelegationGrantPath())
	if err != nil {
		return nil, fmt.Errorf("delegation grant not readable (%v); refusing to open an anonymous privileged transport", err)
	}
	uid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil {
		return nil, fmt.Errorf("delegation grant %q is not a uid: %w", string(raw), err)
	}
	// A crashed predecessor leaves the socket file behind; bind fails on it.
	_ = os.Remove(systemSocketPath)
	l, err := net.Listen("unix", systemSocketPath)
	if err != nil {
		return nil, err
	}
	// The socket itself must admit connecting users; the per-connection
	// credential check closes everyone but the granted uid.
	if err := os.Chmod(systemSocketPath, 0o666); err != nil {
		l.Close()
		return nil, err
	}
	return &uidListener{inner: l, uid: uid}, nil
}

func dialPrivileged(ctx context.Context, _, _ string) (net.Conn, error) {
	var d net.Dialer
	return d.DialContext(ctx, "unix", systemSocketPath)
}

func privilegedProbeTimeout() time.Duration { return 1500 * time.Millisecond }

// uidListener drops accepted connections whose peer effective uid does not
// match the delegation grant, keeping every handler free of identity logic.
type uidListener struct {
	inner net.Listener
	uid   int
}

func (l *uidListener) Accept() (net.Conn, error) {
	for {
		c, err := l.inner.Accept()
		if err != nil {
			return nil, err
		}
		if ok, err := connPeerUIDMatches(c, l.uid); err != nil || !ok {
			c.Close()
			continue
		}
		return c, nil
	}
}

func (l *uidListener) Close() error   { return l.inner.Close() }
func (l *uidListener) Addr() net.Addr { return l.inner.Addr() }

func connPeerUIDMatches(c net.Conn, want int) (bool, error) {
	uc, ok := c.(*net.UnixConn)
	if !ok {
		return false, errors.New("not a unix connection")
	}
	raw, err := uc.SyscallConn()
	if err != nil {
		return false, err
	}
	var cred *unix.Ucred
	var credErr error
	if err := raw.Control(func(fd uintptr) {
		cred, credErr = unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
	}); err != nil {
		return false, err
	}
	if credErr != nil {
		return false, credErr
	}
	return int(cred.Uid) == want, nil
}
