package server

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
	contracts "github.com/andriishupta/encois/packages/contracts"
)

var ErrGraphNotConfigured = errors.New("graph store is not configured")

type unconfiguredGraphStore struct{}

func (unconfiguredGraphStore) Query(context.Context, domain.GraphQueryRequest) (domain.GraphQueryResponse, error) {
	return domain.GraphQueryResponse{}, ErrGraphNotConfigured
}

func (unconfiguredGraphStore) Upsert(context.Context, domain.GraphMutation) error {
	return ErrGraphNotConfigured
}

type GraphStore interface {
	Query(context.Context, domain.GraphQueryRequest) (domain.GraphQueryResponse, error)
	Upsert(context.Context, domain.GraphMutation) error
}

type memoryGraphStore struct {
	mu    sync.RWMutex
	nodes map[string]scopedGraphNode
	edges map[string]scopedGraphEdge
}

type scopedGraphNode struct {
	organizationID string
	node           domain.GraphNode
}

type scopedGraphEdge struct {
	organizationID string
	edge           domain.GraphEdge
}

func newMemoryGraphStore() GraphStore {
	return &memoryGraphStore{nodes: make(map[string]scopedGraphNode), edges: make(map[string]scopedGraphEdge)}
}

func (s *memoryGraphStore) Upsert(_ context.Context, mutation domain.GraphMutation) error {
	if err := validateGraphMutation(mutation); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, node := range mutation.Nodes {
		s.nodes[mutation.OrganizationID+"\x00"+node.ID] = scopedGraphNode{organizationID: mutation.OrganizationID, node: node}
	}
	for _, edge := range mutation.Edges {
		s.edges[mutation.OrganizationID+"\x00"+edge.ID] = scopedGraphEdge{organizationID: mutation.OrganizationID, edge: edge}
	}
	return nil
}

func (s *memoryGraphStore) Query(_ context.Context, request domain.GraphQueryRequest) (domain.GraphQueryResponse, error) {
	if err := validateGraphQuery(request); err != nil {
		return domain.GraphQueryResponse{}, err
	}
	s.mu.Lock()
	s.ensureLocalFixture(request.OrganizationID)
	defer s.mu.Unlock()
	nodes := make([]domain.GraphNode, 0, len(s.nodes))
	edges := make([]domain.GraphEdge, 0, len(s.edges))
	matchingNodeIDs := make(map[string]struct{})
	for _, candidate := range s.nodes {
		if candidate.organizationID != request.OrganizationID || !graphNodeMatchesQuery(candidate.node, request) || !visible(candidate.node.Provenance, request.Scope) {
			continue
		}
		if len(nodes) < graphResultLimit(request) {
			nodes = append(nodes, candidate.node)
			matchingNodeIDs[candidate.node.ID] = struct{}{}
		}
	}
	if len(nodes) < graphResultLimit(request) {
		for _, candidate := range s.edges {
			if candidate.organizationID != request.OrganizationID || !visible(candidate.edge.Provenance, request.Scope) || !graphEdgeMatchesLogicalQuery(candidate.edge, request) || !graphEdgeTouches(candidate.edge, matchingNodeIDs) {
				continue
			}
			neighborID := candidate.edge.SourceID
			if _, sourceIncluded := matchingNodeIDs[neighborID]; sourceIncluded {
				neighborID = candidate.edge.TargetID
			}
			if _, alreadyIncluded := matchingNodeIDs[neighborID]; alreadyIncluded {
				continue
			}
			neighbor, ok := s.nodes[request.OrganizationID+"\x00"+neighborID]
			if !ok || !visible(neighbor.node.Provenance, request.Scope) {
				continue
			}
			nodes = append(nodes, neighbor.node)
			matchingNodeIDs[neighborID] = struct{}{}
		}
	}
	for _, candidate := range s.edges {
		if candidate.organizationID == request.OrganizationID && graphEdgeMatchesQuery(candidate.edge, request, matchingNodeIDs) && visible(candidate.edge.Provenance, request.Scope) && len(edges) < graphResultLimit(request) {
			edges = append(edges, candidate.edge)
		}
	}
	return graphResponse(request, nodes, edges), nil
}

// ensureLocalFixture gives every local organization a small deterministic
// context even before a source-ingestion workflow has projected live facts.
// Keys still include organizationID, so identical fixture node IDs can never
// make one tenant's graph visible to another tenant.
func (s *memoryGraphStore) ensureLocalFixture(organizationID string) {
	if organizationID == "" {
		return
	}
	prefix := organizationID + "\x00"
	for key := range s.nodes {
		if strings.HasPrefix(key, prefix) {
			return
		}
	}

	projectID := "mock-project-checkout"
	blockerID := "mock-blocker-release-risk"
	s.nodes[prefix+projectID] = scopedGraphNode{
		organizationID: organizationID,
		node: domain.GraphNode{
			ID:   projectID,
			Type: "project",
			Properties: map[string]any{
				"organizationId": organizationID,
				"name":           "Checkout",
				"status":         "active",
			},
		},
	}
	s.nodes[prefix+blockerID] = scopedGraphNode{
		organizationID: organizationID,
		node: domain.GraphNode{
			ID:   blockerID,
			Type: "blocker",
			Properties: map[string]any{
				"organizationId": organizationID,
				"projectId":      projectID,
				"status":         "blocked",
				"title":          "Mock release risk requires QA confirmation",
			},
		},
	}
	s.edges[prefix+"mock-edge-release-risk"] = scopedGraphEdge{
		organizationID: organizationID,
		edge: domain.GraphEdge{
			ID:           "mock-edge-release-risk",
			SourceID:     projectID,
			TargetID:     blockerID,
			Relationship: "has_blocker",
			Properties:   map[string]any{"organizationId": organizationID},
		},
	}
}

func graphResponse(request domain.GraphQueryRequest, nodes []domain.GraphNode, edges []domain.GraphEdge) domain.GraphQueryResponse {
	response := domain.GraphQueryResponse{
		ContractVersion: domain.GraphQueryResultContractVersion,
		RequestID:       request.RequestID,
		Status:          "completed",
		Nodes:           nodes,
		Edges:           edges,
	}
	if len(nodes) > 0 || len(edges) > 0 {
		now := time.Now().UTC().Format(time.RFC3339)
		response.EvidenceRefs = []string{"graph://organizations/" + request.OrganizationID + "/queries/" + request.Query}
		response.Freshness = []contracts.SourceFreshness{{Source: "graph", ObservedAt: now, IngestedAt: now, Status: contracts.FreshnessFresh}}
	}
	return response
}

func graphNodeMatchesQuery(node domain.GraphNode, request domain.GraphQueryRequest) bool {
	if nodeType := graphParamString(request, "nodeType"); nodeType != "" && node.Type != nodeType {
		return false
	}
	if isBroadGraphQuery(request.Query) {
		return true
	}
	switch strings.TrimSpace(request.Query) {
	case "project.related_entities":
		projectID := graphParamString(request, "projectId")
		return projectID != "" && (node.ID == projectID || stringProperty(node.Properties, "projectId") == projectID)
	case "release.blockers":
		return stringProperty(node.Properties, "status") == "blocked" || node.Type == "blocker"
	default:
		return false
	}
}

func graphEdgeMatchesQuery(edge domain.GraphEdge, request domain.GraphQueryRequest, matchingNodeIDs map[string]struct{}) bool {
	if matchingNodeIDs != nil {
		if !graphEdgeTouchesBoth(edge, matchingNodeIDs) {
			return false
		}
	}
	return graphEdgeMatchesLogicalQuery(edge, request)
}

func graphEdgeMatchesLogicalQuery(edge domain.GraphEdge, request domain.GraphQueryRequest) bool {
	if relationship := graphParamString(request, "relationship"); relationship != "" && edge.Relationship != relationship {
		return false
	}
	if isBroadGraphQuery(request.Query) {
		return true
	}
	projectID := graphParamString(request, "projectId")
	if request.Query == "project.related_entities" {
		return projectID != "" && (edge.SourceID == projectID || edge.TargetID == projectID)
	}
	if request.Query == "release.blockers" {
		return true
	}
	return false
}

func isBroadGraphQuery(query string) bool {
	return query == "all" || query == "all_context" || query == "source.facts"
}

func isSupportedGraphQuery(query string) bool {
	return isBroadGraphQuery(query) || query == "project.related_entities" || query == "release.blockers"
}

func validateGraphQuery(request domain.GraphQueryRequest) error {
	if strings.TrimSpace(request.OrganizationID) == "" {
		return fmt.Errorf("organizationId is required")
	}
	if !isSupportedGraphQuery(strings.TrimSpace(request.Query)) {
		return fmt.Errorf("unsupported logical graph query %q", request.Query)
	}
	return nil
}

func validateGraphMutation(mutation domain.GraphMutation) error {
	if strings.TrimSpace(mutation.OrganizationID) == "" {
		return fmt.Errorf("organizationId is required")
	}
	for _, node := range mutation.Nodes {
		if strings.TrimSpace(node.ID) == "" || strings.TrimSpace(node.Type) == "" || node.Properties == nil {
			return fmt.Errorf("graph node identity and properties are required")
		}
	}
	for _, edge := range mutation.Edges {
		if strings.TrimSpace(edge.ID) == "" || strings.TrimSpace(edge.SourceID) == "" || strings.TrimSpace(edge.TargetID) == "" || strings.TrimSpace(edge.Relationship) == "" || edge.Properties == nil {
			return fmt.Errorf("graph edge identity and properties are required")
		}
	}
	return nil
}

func graphEdgeTouches(edge domain.GraphEdge, nodeIDs map[string]struct{}) bool {
	if nodeIDs == nil {
		return false
	}
	_, sourceMatches := nodeIDs[edge.SourceID]
	_, targetMatches := nodeIDs[edge.TargetID]
	return sourceMatches || targetMatches
}

func graphEdgeTouchesBoth(edge domain.GraphEdge, nodeIDs map[string]struct{}) bool {
	_, sourceMatches := nodeIDs[edge.SourceID]
	_, targetMatches := nodeIDs[edge.TargetID]
	return sourceMatches && targetMatches
}

func graphParamString(request domain.GraphQueryRequest, key string) string {
	value, _ := request.Params[key].(string)
	return strings.TrimSpace(value)
}

func graphResultLimit(request domain.GraphQueryRequest) int {
	limit, ok := request.Params["limit"].(float64)
	if !ok || limit < 1 {
		return 500
	}
	if limit > 500 {
		return 500
	}
	return int(limit)
}

func stringProperty(properties map[string]any, key string) string {
	value, _ := properties[key].(string)
	return value
}

func visible(provenance *contracts.DataProvenance, scope domain.Scope) bool {
	if provenance == nil || len(provenance.VisibilityScope) == 0 || scopeContains(scope, "*") {
		return true
	}
	for _, allowed := range provenance.VisibilityScope {
		if scopeContains(scope, allowed) {
			return true
		}
	}
	return false
}

func scopeContains(scope domain.Scope, target string) bool {
	return contains(scope.IDs, target)
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
