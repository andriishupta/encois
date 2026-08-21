package workflows

import (
	"context"
	"errors"
	"fmt"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/memory"
)

const MemoryActivityName = "ExecuteAgentMemory"

type MemoryActivities struct {
	store memory.Store
}

func NewMemoryActivities(store memory.Store) *MemoryActivities {
	if store == nil {
		store = memory.DeferredStore{}
	}
	return &MemoryActivities{store: store}
}

// ExecuteAgentMemory is an Activity boundary, not Workflow state. The
// deferred result keeps the optional capability non-fatal until a hosted
// Memory Bank adapter is configured.
func (a *MemoryActivities) ExecuteAgentMemory(ctx context.Context, request memory.Request) (memory.Result, error) {
	if err := memory.ValidateRequest(request); err != nil {
		return memory.Result{}, fmt.Errorf("validate agent memory request: %w", err)
	}
	result, err := a.store.Execute(ctx, request)
	if errors.Is(err, memory.ErrNotConfigured) {
		return memory.Result{
			ContractVersion: "agent-memory-result.v1",
			RequestID:       request.RequestID,
			Status:          "deferred",
			Memories:        []memory.Record{},
		}, nil
	}
	if err != nil {
		return memory.Result{}, err
	}
	if err := memory.ValidateResult(result); err != nil {
		return memory.Result{}, fmt.Errorf("validate agent memory result: %w", err)
	}
	return result, nil
}
