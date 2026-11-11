//go:build windows

package daemon

import (
	"context"
	"fmt"
	"net"
	"os"
	"time"

	"github.com/tailscale/go-winio"

	"github.com/openxbond/xbond/internal/platform/paths"
)

// systemPipeName is the named pipe the machine-scoped daemon serves its
// delegation endpoints on. Identity is enforced by the pipe's security
// descriptor, built from the grant the elevated installer recorded — a
// connection IS the credential, so no token rides the requests.
const systemPipeName = `\\.\pipe\xbond-daemon-system`

// listenPrivileged opens the delegation transport for the machine-scoped
// daemon. Without a delegation grant (SID file) there is no caller identity
// to admit, so the transport stays closed: a delegating daemon then reports
// an honest "unreachable" instead of an anonymous backdoor.
func listenPrivileged() (net.Listener, error) {
	sid, err := os.ReadFile(paths.DelegationGrantPath())
	if err != nil {
		return nil, fmt.Errorf("delegation grant not readable (%v); refusing to open an anonymous privileged transport", err)
	}
	sddl := fmt.Sprintf("D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;%s)", string(sid))
	return winio.ListenPipe(systemPipeName, &winio.PipeConfig{SecurityDescriptor: sddl})
}

// dialPrivileged connects the delegating daemon to the machine-scoped
// daemon. The pipe security descriptor does the admission: connecting as the
// granted account succeeds, everyone else gets an access-denied error.
func dialPrivileged(ctx context.Context, _, _ string) (net.Conn, error) {
	return winio.DialPipeContext(ctx, systemPipeName)
}

func privilegedProbeTimeout() time.Duration { return 1500 * time.Millisecond }
