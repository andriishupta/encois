package health

import (
	"encoding/json"
	"net/http"
	"sync/atomic"
)

type Server struct {
	Ready atomic.Bool
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health/live", func(writer http.ResponseWriter, _ *http.Request) {
		writeStatus(writer, http.StatusOK, "live")
	})
	mux.HandleFunc("/health/ready", func(writer http.ResponseWriter, _ *http.Request) {
		if !s.Ready.Load() {
			writeStatus(writer, http.StatusServiceUnavailable, "starting")
			return
		}
		writeStatus(writer, http.StatusOK, "ready")
	})
	return mux
}

func writeStatus(writer http.ResponseWriter, status int, state string) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(map[string]string{"status": state})
}
