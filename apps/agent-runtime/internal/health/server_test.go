package health

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandlerReportsLivenessAndReadiness(t *testing.T) {
	server := &Server{}
	handler := server.Handler()

	live := httptest.NewRecorder()
	handler.ServeHTTP(live, httptest.NewRequest(http.MethodGet, "/health/live", nil))
	if live.Code != http.StatusOK {
		t.Fatalf("live status = %d, want %d", live.Code, http.StatusOK)
	}

	notReady := httptest.NewRecorder()
	handler.ServeHTTP(notReady, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if notReady.Code != http.StatusServiceUnavailable {
		t.Fatalf("not-ready status = %d, want %d", notReady.Code, http.StatusServiceUnavailable)
	}

	server.Ready.Store(true)
	ready := httptest.NewRecorder()
	handler.ServeHTTP(ready, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if ready.Code != http.StatusOK {
		t.Fatalf("ready status = %d, want %d", ready.Code, http.StatusOK)
	}
}
