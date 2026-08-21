package workflows

import (
	"context"
	"testing"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/memory"
)

func TestMemoryActivityReturnsTypedDeferredResult(t *testing.T) {
	activity := NewMemoryActivities(memory.DeferredStore{})
	result, err := activity.ExecuteAgentMemory(context.Background(), memory.Request{
		ContractVersion: "agent-memory.v1",
		RequestID:       "memory-activity-1",
		WorkflowID:      "workflow:org-1:release-1",
		OrganizationID:  "org-1",
		ActorID:         "actor-1",
		Scope:           memory.Scope{IDs: []string{"team-1"}},
		PolicyVersion:   "policy-1",
		AgentDefinition: "release-investigation.synthesizer@1",
		Operation:       "retrieve",
		MemoryScope:     memory.MemoryScope{AgentDefinition: "release-investigation.synthesizer@1", ProjectID: "project-1"},
		Query:           "release risk patterns",
		MaxResults:      5,
	})
	if err != nil {
		t.Fatalf("expected deferred memory operation to be non-fatal: %v", err)
	}
	if result.Status != "deferred" || result.RequestID != "memory-activity-1" || len(result.Memories) != 0 {
		t.Fatalf("unexpected deferred result: %+v", result)
	}
	if err := memory.ValidateResult(result); err != nil {
		t.Fatalf("deferred result must satisfy the result contract: %v", err)
	}
}
