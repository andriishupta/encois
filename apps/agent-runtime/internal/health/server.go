package health

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/memory"
)

type Server struct {
	Ready               atomic.Bool
	MemoryStore         memory.Store
	RuntimeServiceToken string
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
	mux.HandleFunc("/v1/memory/query", s.queryMemory)
	mux.HandleFunc("/v1/memory/mutate", s.mutateMemory)
	return mux
}

func (s *Server) queryMemory(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeError(writer, http.StatusMethodNotAllowed, "method_not_allowed", "memory query requires POST")
		return
	}
	if s.RuntimeServiceToken == "" {
		writeError(writer, http.StatusServiceUnavailable, "service_auth_not_configured", "Agent Runtime service authentication is not configured")
		return
	}
	if !validServiceToken(request, s.RuntimeServiceToken) {
		writeError(writer, http.StatusUnauthorized, "service_unauthenticated", "Agent Runtime service authentication is required")
		return
	}
	if s.MemoryStore == nil {
		writeError(writer, http.StatusServiceUnavailable, "memory_not_configured", "Agent memory is not configured")
		return
	}
	var input memory.Request
	decoder := json.NewDecoder(io.LimitReader(request.Body, 256<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if input.Operation != "retrieve" {
		writeError(writer, http.StatusBadRequest, "read_only_endpoint", "memory inspection only supports retrieve")
		return
	}
	input = memory.SanitizeRequest(input)
	if err := memory.ValidateRequest(input); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_memory_request", err.Error())
		return
	}
	result, err := s.MemoryStore.Execute(request.Context(), input)
	if err != nil {
		writeError(writer, http.StatusBadGateway, "memory_query_failed", err.Error())
		return
	}
	result = memory.SanitizeResult(result)
	if err := memory.ValidateResult(result); err != nil {
		writeError(writer, http.StatusInternalServerError, "invalid_memory_result", err.Error())
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(writer).Encode(result)
}

func (s *Server) mutateMemory(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeError(writer, http.StatusMethodNotAllowed, "method_not_allowed", "memory mutation requires POST")
		return
	}
	if s.RuntimeServiceToken == "" {
		writeError(writer, http.StatusServiceUnavailable, "service_auth_not_configured", "Agent Runtime service authentication is not configured")
		return
	}
	if !validServiceToken(request, s.RuntimeServiceToken) {
		writeError(writer, http.StatusUnauthorized, "service_unauthenticated", "Agent Runtime service authentication is required")
		return
	}
	if s.MemoryStore == nil {
		writeError(writer, http.StatusServiceUnavailable, "memory_not_configured", "Agent memory is not configured")
		return
	}
	var input memory.Request
	decoder := json.NewDecoder(io.LimitReader(request.Body, 256<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if input.Operation != "distill" && input.Operation != "correct" && input.Operation != "delete" {
		writeError(writer, http.StatusBadRequest, "write_operation_not_allowed", "memory mutation only supports add, correct, and delete")
		return
	}
	input = memory.SanitizeRequest(input)
	if err := memory.ValidateRequest(input); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_memory_request", err.Error())
		return
	}
	result, err := s.MemoryStore.Execute(request.Context(), input)
	if err != nil {
		writeError(writer, http.StatusBadGateway, "memory_mutation_failed", err.Error())
		return
	}
	result = memory.SanitizeResult(result)
	if err := memory.ValidateResult(result); err != nil {
		writeError(writer, http.StatusInternalServerError, "invalid_memory_result", err.Error())
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(writer).Encode(result)
}

func validServiceToken(request *http.Request, expected string) bool {
	value := request.Header.Get("X-Encois-Service-Token")
	if value == "" {
		value = strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer ")
	}
	return subtle.ConstantTimeCompare([]byte(value), []byte(expected)) == 1
}

func writeStatus(writer http.ResponseWriter, status int, state string) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(map[string]string{"status": state})
}

func writeError(writer http.ResponseWriter, status int, code, message string) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(map[string]any{"error": map[string]string{"code": code, "message": fmt.Sprintf("%s", message)}})
}
