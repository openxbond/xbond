package daemon

import (
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/openxbond/xbond/internal/engine"
)

// Delegation endpoints for the machine-scoped daemon. They are registered
// only on the privileged transport's mux (named pipe / unix socket), never
// on the token-authenticated TCP listener — admission happens at connect
// time via caller identity, so a request here is already authenticated.
// maxDelegatedConfigBytes bounds a runtime config push; real derivations
// land far below this and anything larger is malformed.
const maxDelegatedConfigBytes = 8 << 20

func (s *Server) registerRemoteRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/localapi/v0/remote/apply", s.handleRemoteApply)
	mux.HandleFunc("/localapi/v0/remote/stop", s.handleRemoteStop)
	mux.HandleFunc("/localapi/v0/remote/status", s.handleRemoteStatus)
	mux.HandleFunc("/localapi/v0/remote/logs", s.handleRemoteLogs)
}

// handleRemoteApply brings the pushed runtime config up in the machine
// session. Re-applying is idempotent where it can be: the same config keeps
// the running core, a changed one reloads it. Only TUN configs are admitted
// — sysproxy and port takeover belong to the user session, where the
// per-user proxy settings live.
func (s *Server) handleRemoteApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, remoteReply{Error: "method not allowed"})
		return
	}
	config, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxDelegatedConfigBytes))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, remoteReply{Error: fmt.Sprintf("read runtime config: %v", err)})
		return
	}
	meta, err := engine.InspectConfig(config)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, remoteReply{Error: fmt.Sprintf("inspect runtime config: %v", err)})
		return
	}
	if meta.TakeoverMode != engine.ModeTun {
		writeJSON(w, http.StatusBadRequest, remoteReply{Error: fmt.Sprintf("refusing to run a %s takeover in the machine session; only TUN is delegated", meta.TakeoverMode)})
		return
	}
	if err := s.engineMgr.Reload(config, nil); err != nil {
		writeJSON(w, http.StatusInternalServerError, remoteReply{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, remoteReply{Ok: true, Status: s.engineMgr.Status()})
}

func (s *Server) handleRemoteStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, remoteReply{Error: "method not allowed"})
		return
	}
	if err := s.engineMgr.Stop(); err != nil {
		writeJSON(w, http.StatusInternalServerError, remoteReply{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, remoteReply{Ok: true})
}

func (s *Server) handleRemoteStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, remoteReply{Ok: true, Status: s.engineMgr.Status()})
}

func (s *Server) handleRemoteLogs(w http.ResponseWriter, r *http.Request) {
	level := engine.LogLevel(r.URL.Query().Get("level"))
	limit := 200
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 1000 {
			limit = n
		}
	}
	logs := s.engineMgr.RingLog().Snapshot(level, limit)
	writeJSON(w, http.StatusOK, map[string]any{"logs": logs})
}
