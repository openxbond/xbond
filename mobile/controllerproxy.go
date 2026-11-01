package mobile

import (
	"fmt"
	"io"
	"net"
	"sync"
)

// controllerProxy pins one loopback port in front of the per-apply core
// controller. The web UI parses the controller address from the served page
// meta once, but the mobile runtime re-picks a random controller port (and
// secret) on every apply — the page would chase a dead endpoint forever.
// The proxy hands out a stable address and injects the current
// Authorization header per connection, so UI traffic and its WebSocket
// streams survive restarts and reloads transparently.
type controllerProxy struct {
	mu     sync.Mutex
	port   int
	engine func() (int, string) // current (clashPort, secret)
	svc    *TunnelService
}

func newControllerProxy(svc *TunnelService, endpoint func() (int, string)) (*controllerProxy, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	p := &controllerProxy{
		port:   l.Addr().(*net.TCPAddr).Port,
		engine: endpoint,
		svc:    svc,
	}
	go p.serve(l)
	return p, nil
}

func (p *controllerProxy) serve(l net.Listener) {
	for {
		conn, err := l.Accept()
		if err != nil {
			return
		}
		go p.handle(conn)
	}
}

func (p *controllerProxy) handle(conn net.Conn) {
	defer conn.Close()
	port, secret := p.engine()
	if port <= 0 {
		return // no live controller; the UI shows its reconnecting state
	}
	upstream, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return
	}
	defer upstream.Close()

	// Read the request head, add the Authorization line, then splice both
	// directions. Works for REST calls and the WebSocket upgrade alike.
	if err := p.injectAuth(conn, upstream, secret); err != nil {
		return
	}
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(upstream, conn); done <- struct{}{} }()
	go func() { _, _ = io.Copy(conn, upstream); done <- struct{}{} }()
	<-done
}

// injectAuth forwards the request head to upstream with an Authorization
// header replacing whatever the client sent.
func (p *controllerProxy) injectAuth(client, upstream net.Conn, secret string) error {
	head := make([]byte, 0, 4096)
	buf := make([]byte, 1)
	for len(head) < 16*1024 {
		n, err := client.Read(buf)
		if n > 0 {
			head = append(head, buf[:n]...)
			if len(head) >= 4 && string(head[len(head)-4:]) == "\r\n\r\n" {
				break
			}
		}
		if err != nil {
			return err
		}
	}
	filtered := make([]byte, 0, len(head)+64)
	lineStart := 0
	authWritten := false
	for i := 0; i < len(head); i++ {
		if head[i] == '\n' {
			line := string(head[lineStart : i+1])
			lower := toLowerAscii(line)
			switch {
			case startsWith(lower, "authorization:") || startsWith(lower, "proxy-authorization:"):
				// drop the client's own auth; ours replaces it
			case line == "\r\n" || line == "\n":
				// end of headers: our Authorization must land before this
				if !authWritten {
					filtered = append(filtered, []byte("Authorization: Bearer "+secret+"\r\n")...)
					authWritten = true
				}
				filtered = append(filtered, head[lineStart:i+1]...)
			default:
				filtered = append(filtered, head[lineStart:i+1]...)
			}
			lineStart = i + 1
		}
	}
	if !authWritten {
		filtered = append(filtered, []byte("Authorization: Bearer "+secret+"\r\n")...)
	}
	_, err := upstream.Write(filtered)
	return err
}

func toLowerAscii(s string) string {
	out := []byte(s)
	for i := range out {
		if out[i] >= 'A' && out[i] <= 'Z' {
			out[i] += 'a' - 'A'
		}
	}
	return string(out)
}

func startsWith(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}
