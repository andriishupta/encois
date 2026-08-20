package policy

import (
	"context"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
)

type Service interface {
	Authorize(context.Context, domain.AuthorizationRequest) domain.AuthorizationResponse
}

type AllowAllPolicy struct {
	version string
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
		Reason:          "MVP allow-all policy; replace with deterministic authorization before production",
	}
}
