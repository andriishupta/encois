package workflows

import (
	"context"
	"fmt"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/memory"
)

const MemoryActivityName = "ExecuteAgentMemory"

type MemoryActivities struct {
	store memory.Store
}

func NewMemoryActivities(store memory.Store) *MemoryActivities {
	if store == nil {
		store = memory.NewMockStore()
	}
	return &MemoryActivities{store: store}
}

// ExecuteAgentMemory is an Activity boundary, not Workflow state. The same
// contract is used by the local mock and Vertex AI Memory Bank adapters.
func (a *MemoryActivities) ExecuteAgentMemory(ctx context.Context, request memory.Request) (memory.Result, error) {
	request = memory.SanitizeRequest(request)
	if err := memory.ValidateRequest(request); err != nil {
		return memory.Result{}, fmt.Errorf("validate agent memory request: %w", err)
	}
	result, err := a.store.Execute(ctx, request)
	if err != nil {
		return memory.Result{}, err
	}
	result = memory.SanitizeResult(result)
	if err := memory.ValidateResult(result); err != nil {
		return memory.Result{}, fmt.Errorf("validate agent memory result: %w", err)
	}
	return result, nil
}
