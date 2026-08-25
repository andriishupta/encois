package server

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/policy"
)

func TestGatewayServiceAuthenticationMatrix(t *testing.T) {
	router := NewRouterWithOptions(policy.NewAllowAllPolicy("policy-test"), slog.Default(), "runtime-token", NewMockDataPlaneAdapters())
	tests := []struct {
		name       string
		authorize  func(*http.Request)
		statusCode int
	}{
		{name: "missing credentials", authorize: func(*http.Request) {}, statusCode: http.StatusUnauthorized},
		{name: "wrong bearer token", authorize: func(request *http.Request) { request.Header.Set("Authorization", "Bearer wrong-token") }, statusCode: http.StatusUnauthorized},
		{name: "wrong service token", authorize: func(request *http.Request) { request.Header.Set("X-Encois-Service-Token", "wrong-token") }, statusCode: http.StatusUnauthorized},
		{name: "correct bearer token", authorize: func(request *http.Request) { request.Header.Set("Authorization", "Bearer runtime-token") }, statusCode: http.StatusOK},
		{name: "correct service token", authorize: func(request *http.Request) { request.Header.Set("X-Encois-Service-Token", "runtime-token") }, statusCode: http.StatusOK},
		{name: "correct bearer plus wrong service token", authorize: func(request *http.Request) {
			request.Header.Set("Authorization", "Bearer runtime-token")
			request.Header.Set("X-Encois-Service-Token", "wrong-token")
		}, statusCode: http.StatusUnauthorized},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/v1/tools", nil)
			test.authorize(request)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.statusCode {
				t.Fatalf("expected HTTP %d, got %d: %s", test.statusCode, response.Code, response.Body.String())
			}
		})
	}
}

func TestGatewayDoesNotTreatHealthAsProofOfServiceAuthorization(t *testing.T) {
	router := NewRouterWithOptions(policy.NewAllowAllPolicy("policy-test"), slog.Default(), "runtime-token", NewMockDataPlaneAdapters())
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health/live", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("public liveness endpoint should remain available: %d: %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/tools", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("protected endpoint was available without service authentication: %d: %s", response.Code, response.Body.String())
	}
}
