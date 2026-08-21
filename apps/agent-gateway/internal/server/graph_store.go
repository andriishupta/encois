package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	"cloud.google.com/go/spanner"
	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
	contracts "github.com/andriishupta/encois/packages/contracts"
	"google.golang.org/api/iterator"
)

var ErrGraphNotConfigured = errors.New("graph store is not configured")

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
	if mutation.OrganizationID == "" {
		return fmt.Errorf("organizationId is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, node := range mutation.Nodes {
		if node.ID == "" || node.Type == "" {
			return fmt.Errorf("graph node id and type are required")
		}
		s.nodes[mutation.OrganizationID+"\x00"+node.ID] = scopedGraphNode{organizationID: mutation.OrganizationID, node: node}
	}
	for _, edge := range mutation.Edges {
		if edge.ID == "" || edge.SourceID == "" || edge.TargetID == "" || edge.Relationship == "" {
			return fmt.Errorf("graph edge identity is incomplete")
		}
		s.edges[mutation.OrganizationID+"\x00"+edge.ID] = scopedGraphEdge{organizationID: mutation.OrganizationID, edge: edge}
	}
	return nil
}

func (s *memoryGraphStore) Query(_ context.Context, request domain.GraphQueryRequest) (domain.GraphQueryResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	nodes := make([]domain.GraphNode, 0, len(s.nodes))
	edges := make([]domain.GraphEdge, 0, len(s.edges))
	for _, candidate := range s.nodes {
		if candidate.organizationID == request.OrganizationID && graphNodeMatchesQuery(candidate.node, request) && visible(candidate.node.Provenance, request.Scope) {
			nodes = append(nodes, candidate.node)
		}
	}
	for _, candidate := range s.edges {
		if candidate.organizationID == request.OrganizationID && graphEdgeMatchesQuery(candidate.edge, request) && visible(candidate.edge.Provenance, request.Scope) {
			edges = append(edges, candidate.edge)
		}
	}
	return graphResponse(request, nodes, edges), nil
}

func graphResponse(request domain.GraphQueryRequest, nodes []domain.GraphNode, edges []domain.GraphEdge) domain.GraphQueryResponse {
	return domain.GraphQueryResponse{
		ContractVersion: domain.GraphQueryResultContractVersion,
		RequestID:       request.RequestID,
		Status:          "completed",
		Nodes:           nodes,
		Edges:           edges,
	}
}

func graphNodeMatchesQuery(node domain.GraphNode, request domain.GraphQueryRequest) bool {
	switch strings.TrimSpace(request.Query) {
	case "all", "all_context", "source.facts":
		return true
	case "project.related_entities":
		projectID, _ := request.Params["projectId"].(string)
		return projectID != "" && (node.ID == projectID || stringProperty(node.Properties, "projectId") == projectID)
	case "release.blockers":
		return stringProperty(node.Properties, "status") == "blocked" || node.Type == "blocker"
	default:
		return false
	}
}

func graphEdgeMatchesQuery(edge domain.GraphEdge, request domain.GraphQueryRequest) bool {
	if request.Query == "all" || request.Query == "all_context" || request.Query == "source.facts" {
		return true
	}
	projectID, _ := request.Params["projectId"].(string)
	return request.Query == "project.related_entities" && projectID != "" && (edge.SourceID == projectID || edge.TargetID == projectID)
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

type spannerGraphStore struct {
	client *spanner.Client
}

func newSpannerGraphStore(ctx context.Context, database string) (GraphStore, func(), error) {
	if strings.TrimSpace(database) == "" {
		return nil, nil, fmt.Errorf("GCP graph mode requires SPANNER_DATABASE")
	}
	client, err := spanner.NewClient(ctx, database)
	if err != nil {
		return nil, nil, fmt.Errorf("create Spanner client: %w", err)
	}
	return &spannerGraphStore{client: client}, client.Close, nil
}

func (s *spannerGraphStore) Upsert(ctx context.Context, mutation domain.GraphMutation) error {
	mutations := make([]*spanner.Mutation, 0, len(mutation.Nodes)+len(mutation.Edges))
	for _, node := range mutation.Nodes {
		properties, err := json.Marshal(node.Properties)
		if err != nil {
			return fmt.Errorf("encode graph node properties: %w", err)
		}
		provenance, err := json.Marshal(node.Provenance)
		if err != nil {
			return fmt.Errorf("encode graph node provenance: %w", err)
		}
		mutations = append(mutations, spanner.InsertOrUpdate("encois_graph_nodes",
			[]string{"organization_id", "id", "type", "properties_json", "provenance_json"},
			[]any{mutation.OrganizationID, node.ID, node.Type, string(properties), string(provenance)}))
	}
	for _, edge := range mutation.Edges {
		properties, err := json.Marshal(edge.Properties)
		if err != nil {
			return fmt.Errorf("encode graph edge properties: %w", err)
		}
		provenance, err := json.Marshal(edge.Provenance)
		if err != nil {
			return fmt.Errorf("encode graph edge provenance: %w", err)
		}
		mutations = append(mutations, spanner.InsertOrUpdate("encois_graph_edges",
			[]string{"organization_id", "id", "source_id", "target_id", "relationship", "properties_json", "provenance_json"},
			[]any{mutation.OrganizationID, edge.ID, edge.SourceID, edge.TargetID, edge.Relationship, string(properties), string(provenance)}))
	}
	if len(mutations) == 0 {
		return nil
	}
	_, err := s.client.Apply(ctx, mutations)
	return err
}

func (s *spannerGraphStore) Query(ctx context.Context, request domain.GraphQueryRequest) (domain.GraphQueryResponse, error) {
	if request.Query != "all" && request.Query != "all_context" && request.Query != "source.facts" && request.Query != "project.related_entities" && request.Query != "release.blockers" {
		return domain.GraphQueryResponse{}, fmt.Errorf("unsupported logical graph query %q", request.Query)
	}
	nodes := make([]domain.GraphNode, 0)
	rowIter := s.client.Single().Query(ctx, spanner.Statement{SQL: "SELECT id, type, properties_json, provenance_json FROM encois_graph_nodes WHERE organization_id = @organization_id", Params: map[string]any{"organization_id": request.OrganizationID}})
	err := func() error {
		defer rowIter.Stop()
		for {
			row, err := rowIter.Next()
			if err == iterator.Done {
				return nil
			}
			if err != nil {
				return err
			}
			var id, typ, propertiesJSON, provenanceJSON string
			if err := row.Columns(&id, &typ, &propertiesJSON, &provenanceJSON); err != nil {
				return err
			}
			var properties map[string]any
			var provenance *contracts.DataProvenance
			if err := json.Unmarshal([]byte(propertiesJSON), &properties); err != nil {
				return err
			}
			if provenanceJSON != "null" && provenanceJSON != "" {
				provenance = &contracts.DataProvenance{}
				if err := json.Unmarshal([]byte(provenanceJSON), provenance); err != nil {
					return err
				}
			}
			node := domain.GraphNode{ID: id, Type: typ, Properties: properties, Provenance: provenance}
			if graphNodeMatchesQuery(node, request) && visible(provenance, request.Scope) {
				nodes = append(nodes, node)
			}
		}
	}()
	if err != nil {
		return domain.GraphQueryResponse{}, fmt.Errorf("query Spanner graph nodes: %w", err)
	}
	edges := make([]domain.GraphEdge, 0)
	edgeIter := s.client.Single().Query(ctx, spanner.Statement{SQL: "SELECT id, source_id, target_id, relationship, properties_json, provenance_json FROM encois_graph_edges WHERE organization_id = @organization_id", Params: map[string]any{"organization_id": request.OrganizationID}})
	defer edgeIter.Stop()
	for {
		row, err := edgeIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return domain.GraphQueryResponse{}, fmt.Errorf("query Spanner graph edges: %w", err)
		}
		var id, sourceID, targetID, relationship, propertiesJSON, provenanceJSON string
		if err := row.Columns(&id, &sourceID, &targetID, &relationship, &propertiesJSON, &provenanceJSON); err != nil {
			return domain.GraphQueryResponse{}, err
		}
		var properties map[string]any
		if err := json.Unmarshal([]byte(propertiesJSON), &properties); err != nil {
			return domain.GraphQueryResponse{}, err
		}
		var provenance *contracts.DataProvenance
		if provenanceJSON != "null" && provenanceJSON != "" {
			provenance = &contracts.DataProvenance{}
			if err := json.Unmarshal([]byte(provenanceJSON), provenance); err != nil {
				return domain.GraphQueryResponse{}, err
			}
		}
		edge := domain.GraphEdge{ID: id, SourceID: sourceID, TargetID: targetID, Relationship: relationship, Properties: properties, Provenance: provenance}
		if graphEdgeMatchesQuery(edge, request) && visible(provenance, request.Scope) {
			edges = append(edges, edge)
		}
	}
	return graphResponse(request, nodes, edges), nil
}
