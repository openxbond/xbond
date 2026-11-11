package daemon

import "net/http"

func (s *Server) handleSubURL(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var request struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}
	if !decodeRuntimeRequest(w, r, &request) {
		return
	}
	if err := s.runtime.ChangeSourceURL(request.ID, request.URL); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
