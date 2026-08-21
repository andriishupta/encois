package policy

import (
	"context"
	"fmt"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
)

type Service interface {
	Authorize(context.Context, domain.AuthorizationRequest) domain.AuthorizationResponse
}

type AllowAllPolicy struct {
	version string
}

// ReadOnlyToolPolicy is the first real policy boundary. It intentionally
// supports only the synthetic read-only fixtures used by the vertical slice.
// Provider grants and hierarchy expansion can be added behind this interface
// without allowing arbitrary tool execution.
type ReadOnlyToolPolicy struct {
	version string
	tools   map[string]struct{}
}

func NewReadOnlyToolPolicy(version string) *ReadOnlyToolPolicy {
	return &ReadOnlyToolPolicy{
		version: version,
		tools: map[string]struct{}{
			"jira.project_tasks":      {},
			"github.project_activity": {},
		},
	}
}

func (p *ReadOnlyToolPolicy) Authorize(_ context.Context, request domain.AuthorizationRequest) domain.AuthorizationResponse {
	response := domain.AuthorizationResponse{
		ContractVersion: domain.AuthorizationContractVersion,
		RequestID:       request.RequestID,
		PolicyVersion:   p.version,
	}
	if request.OrganizationID == "" || request.WorkflowID == "" || request.ActorID == "" {
		response.Decision = "deny"
		response.Reason = "execution context is incomplete"
		return response
	}
	if request.PolicyVersion != p.version {
		response.Decision = "deny"
		response.Reason = fmt.Sprintf("policy version %q is not accepted", request.PolicyVersion)
		return response
	}
	if request.Scope.Empty() {
		response.Decision = "deny"
		response.Reason = "execution scope is empty"
		return response
	}
	if request.Action != "invoke_tool" {
		response.Decision = "deny"
		response.Reason = fmt.Sprintf("action %q is not enabled by the read-only MVP policy", request.Action)
		return response
	}
	if _, ok := p.tools[request.Resource]; !ok {
		response.Decision = "deny"
		response.Reason = fmt.Sprintf("tool %q is not allowlisted", request.Resource)
		return response
	}
	response.Allowed = true
	response.Decision = "allow"
	response.Reason = "allowlisted synthetic read-only tool"
	return response
}

func NewAllowAllPolicy(version string) *AllowAllPolicy {
	return &AllowAllPolicy{version: version}
}

func (p *AllowAllPolicy) Authorize(_ context.Context, request domain.AuthorizationRequest) domain.AuthorizationResponse {
	return domain.AuthorizationResponse{
		ContractVersion: domain.AuthorizationContractVersion,
		RequestID:       request.RequestID,
		Allowed:         true,
		Decision:        "allow",
		PolicyVersion:   p.version,
		Reason:          "test-only allow-all policy",
	}
}
