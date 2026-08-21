package server

import (
	"context"
	"errors"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
)

// ErrGraphNotConfigured is returned by the default adapter until Spanner
// Graph is configured. Keeping this as a typed boundary lets the HTTP layer
// preserve the same auth, scope, and response contract for a future adapter.
var ErrGraphNotConfigured = errors.New("graph store is not configured")

// GraphStore is the narrow data-plane boundary for normalized company facts
// and relationships. Implementations must enforce organization/scope limits
// again at the data layer; the model or query string is never an authority.
type GraphStore interface {
	Query(context.Context, domain.GraphQueryRequest) (domain.GraphQueryResponse, error)
}

type deferredGraphStore struct{}

func (deferredGraphStore) Query(context.Context, domain.GraphQueryRequest) (domain.GraphQueryResponse, error) {
	return domain.GraphQueryResponse{}, ErrGraphNotConfigured
}

func newDeferredGraphStore() GraphStore {
	return deferredGraphStore{}
}
