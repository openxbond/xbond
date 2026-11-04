//go:build darwin

package daemon

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"
	"time"

	"golang.org/x/sys/unix"

	"github.com/openxbond/xbond/internal/platform/paths"
)

// systemSocketPath is the unix socket the machine-scoped daemon serves its
// delegation endpoints on. /var/run keeps the socket world-traversable (the
// data dir is root-owned and would block the delegating user from even
// reaching it); admission happens per connection via peer credentials.
const systemSocketPath = "/var/run/xbond-daemon-system.sock"

// listenPrivileged opens the delegation transport for the machine-scoped
// daemon. Without a delegation grant (uid file) there is no caller identity
// to admit, so the transport stays closed: a delegating daemon then reports
// an honest "unreachable" instead of an anonymous backdoor.
func listenPrivileged() (net.Listener, error) {
	raw, err := os.ReadFile(paths.DelegationGrantPath())
	if err != nil {
		return nil, fmt.Errorf("delegation grant not readable (%v); refusing to open an anonymous privileged transport", err)
	}
	uid, err := strconv.Atoi(string(raw))
	if err != nil {
		return nil, fmt.Errorf("delegation grant %q is not a uid: %w", string(raw), err)
	}
	// A crashed predecessor leaves the socket file behind; bind fails on it.
	_ = os.Remove(systemSocketPath)
	l, err := net.Listen("unix", systemSocketPath)
	if err != nil {
		return nil, err
	}
	// LaunchDaemons run as root: the socket itself must admit connecting
	// users, and the per-connection credential check below closes everyone
	// but the granted uid.
	if err := os.Chmod(systemSocketPath, 0o666); err != nil {
		l.Close()
		return nil, err
	}
	return &uidListener{inner: l, uid: uid}, nil
}

// dialPrivileged connects the delegating daemon to the machine-scoped
// daemon. The server verifies the peer credential (effective uid) on
// accept; connections from other accounts are closed before any request
// is read.
func dialPrivileged(ctx context.Context, _, _ string) (net.Conn, error) {
	var d net.Dialer
	return d.DialContext(ctx, "unix", systemSocketPath)
}

func privilegedProbeTimeout() time.Duration { return 1500 * time.Millisecond }

// uidListener drops accepted connections whose peer effective uid does not
// match the delegation grant. Verify-on-accept keeps every handler free of
// identity logic.
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
		ok, err := connPeerUIDMatches(c, l.uid)
		if err != nil {
			c.Close()
			continue
		}
		if !ok {
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
	f, err := uc.File()
	if err != nil {
		return false, err
	}
	defer f.Close()
	cred, err := unix.GetsockoptXucred(int(f.Fd()), unix.SOL_LOCAL, unix.LOCAL_PEERCRED)
	if err != nil {
		return false, err
	}
	return int(cred.Uid) == want, nil
}
