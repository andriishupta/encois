package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
)

const executionCapabilityVersion = "execution-capability.v1"
const executionCapabilityAudience = "agent-gateway"

func workflowIDBelongsToOrganization(workflowID, organizationID string) bool {
	return organizationID != "" && (strings.HasPrefix(workflowID, "org:"+organizationID+":") ||
		strings.HasPrefix(workflowID, "workflow:"+organizationID+":"))
}

type executionCapabilityClaims struct {
	Version       string   `json:"v"`
	Audience      string   `json:"aud"`
	Organization  string   `json:"organizationId"`
	Workflow      string   `json:"workflowId"`
	Actor         string   `json:"actorId"`
	PolicyVersion string   `json:"policyVersion"`
	ScopeIDs      []string `json:"scopeIds"`
	IssuedAt      int64    `json:"issuedAt"`
	ExpiresAt     int64    `json:"expiresAt"`
}

type executionCapabilityHeader struct {
	Algorithm string `json:"alg"`
	Type      string `json:"typ"`
}

func verifyExecutionCapability(raw, secret string, context domain.ExecutionContext, now time.Time) error {
	if raw == "" || secret == "" {
		return fmt.Errorf("execution capability is missing")
	}
	parts := splitCapability(raw)
	if len(parts) != 3 {
		return fmt.Errorf("execution capability format is invalid")
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return fmt.Errorf("execution capability header is invalid")
	}
	var header executionCapabilityHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil || header.Algorithm != "HS256" || header.Type != executionCapabilityVersion {
		return fmt.Errorf("execution capability header is invalid")
	}
	expectedMAC := hmac.New(sha256.New, []byte(secret))
	_, _ = expectedMAC.Write([]byte(parts[0] + "." + parts[1]))
	suppliedMAC, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(expectedMAC.Sum(nil), suppliedMAC) {
		return fmt.Errorf("execution capability signature is invalid")
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return fmt.Errorf("execution capability payload is invalid")
	}
	var claims executionCapabilityClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return fmt.Errorf("execution capability payload is invalid")
	}
	if claims.Version != executionCapabilityVersion || claims.Audience != executionCapabilityAudience ||
		claims.Organization != context.OrganizationID || claims.Workflow != context.WorkflowID ||
		claims.Actor != context.ActorID || claims.PolicyVersion != context.PolicyVersion {
		return fmt.Errorf("execution capability claims do not match execution context")
	}
	if !workflowIDBelongsToOrganization(context.WorkflowID, context.OrganizationID) {
		return fmt.Errorf("workflow id is outside the organization scope")
	}
	nowSeconds := now.Unix()
	if claims.IssuedAt > nowSeconds+30 || claims.ExpiresAt <= nowSeconds || claims.ExpiresAt <= claims.IssuedAt {
		return fmt.Errorf("execution capability is expired or not yet valid")
	}
	expectedScope := uniqueSorted(context.Scope.IDs)
	actualScope := uniqueSorted(claims.ScopeIDs)
	if !sameStrings(expectedScope, actualScope) {
		return fmt.Errorf("execution capability scope does not match execution context")
	}
	return nil
}

func uniqueSorted(values []string) []string {
	unique := make(map[string]struct{}, len(values))
	for _, value := range values {
		unique[value] = struct{}{}
	}
	result := make([]string, 0, len(unique))
	for value := range unique {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func splitCapability(value string) []string {
	parts := make([]string, 0, 3)
	start := 0
	for index := 0; index < len(value); index++ {
		if value[index] != '.' {
			continue
		}
		parts = append(parts, value[start:index])
		start = index + 1
	}
	parts = append(parts, value[start:])
	return parts
}

func sameStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
