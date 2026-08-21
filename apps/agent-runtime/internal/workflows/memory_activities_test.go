package workflows

import (
	"context"
	"testing"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/memory"
)

func TestMemoryActivityReturnsTypedMockResult(t *testing.T) {
	activity := NewMemoryActivities(memory.NewMockStore())
	result, err := activity.ExecuteAgentMemory(context.Background(), memory.Request{
		ContractVersion: "agent-memory.v1",
		RequestID:       "memory-activity-1",
		WorkflowID:      "workflow:org-1:release-1",
		OrganizationID:  "org-1",
		ActorID:         "actor-1",
		Scope:           memory.Scope{IDs: []string{"team-1"}},
		PolicyVersion:   "policy-1",
		Capability:      "test-capability",
		AgentDefinition: "release-investigation.synthesizer@1",
		Operation:       "retrieve",
		MemoryScope:     memory.MemoryScope{AgentDefinition: "release-investigation.synthesizer@1", ProjectID: "project-1"},
		Query:           "release risk patterns",
		MaxResults:      5,
	})
	if err != nil {
		t.Fatalf("expected mock memory operation to succeed: %v", err)
	}
	if result.Status != "completed" || result.RequestID != "memory-activity-1" || len(result.Memories) != 0 {
		t.Fatalf("unexpected mock result: %+v", result)
	}
	if err := memory.ValidateResult(result); err != nil {
		t.Fatalf("mock result must satisfy the result contract: %v", err)
	}
}
