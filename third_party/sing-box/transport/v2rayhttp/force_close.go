// Package v2rayhttp — patched copy of sing-box v1.13.21's
// transport/v2rayhttp/force_close.go (MIT, © sing-box contributors).
//
// WHY THIS FILE EXISTS: the upstream file reaches x/net/http2's private
// connPool field through go:linkname to the field symbol
// `(*Transport).connPool`. With x/net ≥ v0.61 (forced by mihomo and other
// dependencies in this module) that symbol is no longer emitted in
// c-shared/PIC builds on android arm and x86_64 — gomobile bind fails with
// a relocation error (arm64 happened to keep the symbol). This patch
// replaces the linkname with a reflect-based read of the same field, which
// the upstream code already half-prepares for (it imports reflect and
// mirrors the struct layout). Applied only to the mobile bind via
// `-overlay` in scripts/mobile.ts; desktop and daemon builds keep the
// stock upstream module. Layout checked against x/net v0.61:
// clientConnPool{t *Transport; mu sync.Mutex; conns map[string][]*ClientConn}.
package v2rayhttp

import (
	"net/http"
	"reflect"
	"sync"
	"unsafe"

	E "github.com/sagernet/sing/common/exceptions"

	"golang.org/x/net/http2"
)

type clientConnPool struct {
	t     *http2.Transport
	mu    sync.Mutex
	conns map[string][]*http2.ClientConn // key is host:port
}

type efaceWords struct {
	typ  unsafe.Pointer
	data unsafe.Pointer
}

func ResetTransport(rawTransport http.RoundTripper) http.RoundTripper {
	switch transport := rawTransport.(type) {
	case *http.Transport:
		transport.CloseIdleConnections()
		return transport.Clone()
	case *http2.Transport:
		connPool := transportConnPool(transport)
		if connPool == nil {
			// Field missing (upstream renamed it): keep the transport as-is
			// instead of nil-panicking; idle conns will age out normally.
			return transport
		}
		p := (*clientConnPool)((*efaceWords)(unsafe.Pointer(&connPool)).data)
		p.mu.Lock()
		defer p.mu.Unlock()
		for _, vv := range p.conns {
			for _, cc := range vv {
				cc.Close()
			}
		}
		return transport
	default:
		panic(E.New("unknown transport type: ", reflect.TypeOf(transport)))
	}
}

func transportConnPool(t *http2.Transport) http2.ClientConnPool {
	v := reflect.ValueOf(t).Elem().FieldByName("connPool")
	if !v.IsValid() {
		return nil
	}
	pool, _ := v.Interface().(http2.ClientConnPool)
	return pool
}
