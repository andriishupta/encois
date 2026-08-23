package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

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
		response.Freshness = []contracts.SourceFreshness{{Source: "graph", ObservedAt: now, IngestedAt: now, Status: contracts.FreshnessFresh}}
	}
	return response
}

func graphNodeMatchesQuery(node domain.GraphNode, request domain.GraphQueryRequest) bool {
	if nodeType := graphParamString(request, "nodeType"); nodeType != "" && node.Type != nodeType {
		return false
	}
	switch strings.TrimSpace(request.Query) {
	case "all", "all_context", "source.facts":
		return true
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
	if request.Query == "all" || request.Query == "all_context" || request.Query == "source.facts" {
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
	nodes, matchingNodeIDs, err := s.readGraphNodes(ctx, graphNodesStatement(request), request, func(node domain.GraphNode) bool {
		return graphNodeMatchesQuery(node, request)
	})
	if err != nil {
		return domain.GraphQueryResponse{}, fmt.Errorf("query Spanner graph nodes: %w", err)
	}
	candidateEdges, err := s.readGraphEdges(ctx, graphEdgesStatementForEndpoints(request, matchingNodeIDs))
	if err != nil {
		return domain.GraphQueryResponse{}, fmt.Errorf("query Spanner graph candidate edges: %w", err)
	}
	neighborIDs := make(map[string]struct{})
	for _, edge := range candidateEdges {
		if !graphEdgeMatchesLogicalQuery(edge, request) || !visible(edge.Provenance, request.Scope) || !graphEdgeTouches(edge, matchingNodeIDs) {
			continue
		}
		if _, sourceIncluded := matchingNodeIDs[edge.SourceID]; sourceIncluded {
			neighborIDs[edge.TargetID] = struct{}{}
		}
		if _, targetIncluded := matchingNodeIDs[edge.TargetID]; targetIncluded {
			neighborIDs[edge.SourceID] = struct{}{}
		}
	}
	for nodeID := range matchingNodeIDs {
		delete(neighborIDs, nodeID)
	}
	if len(neighborIDs) > 0 && len(nodes) < graphResultLimit(request) {
		neighborNodes, _, neighborErr := s.readGraphNodes(ctx, graphNeighborNodesStatement(request, neighborIDs), request, func(domain.GraphNode) bool { return true })
		if neighborErr != nil {
			return domain.GraphQueryResponse{}, fmt.Errorf("query Spanner graph neighbors: %w", neighborErr)
		}
		for _, node := range neighborNodes {
			if len(nodes) >= graphResultLimit(request) {
				break
			}
			if _, alreadyIncluded := matchingNodeIDs[node.ID]; alreadyIncluded {
				continue
			}
			nodes = append(nodes, node)
			matchingNodeIDs[node.ID] = struct{}{}
		}
	}
	candidateEdges, err = s.readGraphEdges(ctx, graphEdgesStatementForNodes(request, matchingNodeIDs))
	if err != nil {
		return domain.GraphQueryResponse{}, fmt.Errorf("query Spanner graph edges: %w", err)
	}
	edges := make([]domain.GraphEdge, 0, len(candidateEdges))
	for _, edge := range candidateEdges {
		if graphEdgeMatchesQuery(edge, request, matchingNodeIDs) && visible(edge.Provenance, request.Scope) && len(edges) < graphResultLimit(request) {
			edges = append(edges, edge)
		}
	}
	return graphResponse(request, nodes, edges), nil
}

func (s *spannerGraphStore) readGraphNodes(ctx context.Context, statement spanner.Statement, request domain.GraphQueryRequest, matches func(domain.GraphNode) bool) ([]domain.GraphNode, map[string]struct{}, error) {
	nodes := make([]domain.GraphNode, 0)
	matchingNodeIDs := make(map[string]struct{})
	rowIter := s.client.Single().Query(ctx, statement)
	defer rowIter.Stop()
	for {
		row, err := rowIter.Next()
		if err == iterator.Done {
			return nodes, matchingNodeIDs, nil
		}
		if err != nil {
			return nil, nil, err
		}
		node, err := graphNodeFromRow(row)
		if err != nil {
			return nil, nil, err
		}
		if matches(node) && visible(node.Provenance, request.Scope) && len(nodes) < graphResultLimit(request) {
			nodes = append(nodes, node)
			matchingNodeIDs[node.ID] = struct{}{}
		}
	}
}

func (s *spannerGraphStore) readGraphEdges(ctx context.Context, statement spanner.Statement) ([]domain.GraphEdge, error) {
	edges := make([]domain.GraphEdge, 0)
	rowIter := s.client.Single().Query(ctx, statement)
	defer rowIter.Stop()
	for {
		row, err := rowIter.Next()
		if err == iterator.Done {
			return edges, nil
		}
		if err != nil {
			return nil, err
		}
		edge, err := graphEdgeFromRow(row)
		if err != nil {
			return nil, err
		}
		edges = append(edges, edge)
	}
}

func graphNodeFromRow(row *spanner.Row) (domain.GraphNode, error) {
	var id, typ, propertiesJSON, provenanceJSON string
	if err := row.Columns(&id, &typ, &propertiesJSON, &provenanceJSON); err != nil {
		return domain.GraphNode{}, err
	}
	var properties map[string]any
	if err := json.Unmarshal([]byte(propertiesJSON), &properties); err != nil {
		return domain.GraphNode{}, err
	}
	provenance, err := graphProvenance(provenanceJSON)
	if err != nil {
		return domain.GraphNode{}, err
	}
	return domain.GraphNode{ID: id, Type: typ, Properties: properties, Provenance: provenance}, nil
}

func graphEdgeFromRow(row *spanner.Row) (domain.GraphEdge, error) {
	var id, sourceID, targetID, relationship, propertiesJSON, provenanceJSON string
	if err := row.Columns(&id, &sourceID, &targetID, &relationship, &propertiesJSON, &provenanceJSON); err != nil {
		return domain.GraphEdge{}, err
	}
	var properties map[string]any
	if err := json.Unmarshal([]byte(propertiesJSON), &properties); err != nil {
		return domain.GraphEdge{}, err
	}
	provenance, err := graphProvenance(provenanceJSON)
	if err != nil {
		return domain.GraphEdge{}, err
	}
	return domain.GraphEdge{ID: id, SourceID: sourceID, TargetID: targetID, Relationship: relationship, Properties: properties, Provenance: provenance}, nil
}

func graphProvenance(value string) (*contracts.DataProvenance, error) {
	if value == "null" || value == "" {
		return nil, nil
	}
	provenance := &contracts.DataProvenance{}
	if err := json.Unmarshal([]byte(value), provenance); err != nil {
		return nil, err
	}
	return provenance, nil
}

func graphNodesStatement(request domain.GraphQueryRequest) spanner.Statement {
	conditions := []string{"organization_id = @organization_id"}
	params := map[string]any{"organization_id": request.OrganizationID}
	if nodeType := graphParamString(request, "nodeType"); nodeType != "" {
		conditions = append(conditions, "type = @node_type")
		params["node_type"] = nodeType
	}
	switch request.Query {
	case "project.related_entities":
		if projectID := graphParamString(request, "projectId"); projectID != "" {
			conditions = append(conditions, "(id = @project_id OR JSON_VALUE(properties_json, '$.projectId') = @project_id)")
			params["project_id"] = projectID
		}
	case "release.blockers":
		conditions = append(conditions, "(type = 'blocker' OR JSON_VALUE(properties_json, '$.status') = 'blocked')")
	}
	return spanner.Statement{
		SQL:    "SELECT id, type, properties_json, provenance_json FROM encois_graph_nodes WHERE " + strings.Join(conditions, " AND "),
		Params: params,
	}
}

func graphEdgesStatement(request domain.GraphQueryRequest) spanner.Statement {
	return graphEdgesStatementForNodes(request, nil)
}

func graphEdgesStatementForEndpoints(request domain.GraphQueryRequest, endpointNodeIDs map[string]struct{}) spanner.Statement {
	conditions := []string{"organization_id = @organization_id"}
	params := map[string]any{"organization_id": request.OrganizationID}
	if relationship := graphParamString(request, "relationship"); relationship != "" {
		conditions = append(conditions, "relationship = @relationship")
		params["relationship"] = relationship
	}
	if request.Query == "project.related_entities" {
		if projectID := graphParamString(request, "projectId"); projectID != "" {
			conditions = append(conditions, "(source_id = @project_id OR target_id = @project_id)")
			params["project_id"] = projectID
		}
	}
	nodeIDs := make([]string, 0, len(endpointNodeIDs))
	for nodeID := range endpointNodeIDs {
		nodeIDs = append(nodeIDs, nodeID)
	}
	sort.Strings(nodeIDs)
	if len(nodeIDs) == 0 {
		conditions = append(conditions, "FALSE")
	} else {
		conditions = append(conditions, "(source_id IN UNNEST(@endpoint_node_ids) OR target_id IN UNNEST(@endpoint_node_ids))")
		params["endpoint_node_ids"] = nodeIDs
	}
	return spanner.Statement{
		SQL:    "SELECT id, source_id, target_id, relationship, properties_json, provenance_json FROM encois_graph_edges WHERE " + strings.Join(conditions, " AND "),
		Params: params,
	}
}

func graphNeighborNodesStatement(request domain.GraphQueryRequest, nodeIDs map[string]struct{}) spanner.Statement {
	conditions := []string{"organization_id = @organization_id"}
	params := map[string]any{"organization_id": request.OrganizationID}
	ids := make([]string, 0, len(nodeIDs))
	for nodeID := range nodeIDs {
		ids = append(ids, nodeID)
	}
	sort.Strings(ids)
	if len(ids) == 0 {
		conditions = append(conditions, "FALSE")
	} else {
		conditions = append(conditions, "id IN UNNEST(@neighbor_node_ids)")
		params["neighbor_node_ids"] = ids
	}
	return spanner.Statement{
		SQL:    "SELECT id, type, properties_json, provenance_json FROM encois_graph_nodes WHERE " + strings.Join(conditions, " AND "),
		Params: params,
	}
}

func graphEdgesStatementForNodes(request domain.GraphQueryRequest, matchingNodeIDs map[string]struct{}) spanner.Statement {
	conditions := []string{"organization_id = @organization_id"}
	params := map[string]any{"organization_id": request.OrganizationID}
	if relationship := graphParamString(request, "relationship"); relationship != "" {
		conditions = append(conditions, "relationship = @relationship")
		params["relationship"] = relationship
	}
	if request.Query == "project.related_entities" {
		if projectID := graphParamString(request, "projectId"); projectID != "" {
			conditions = append(conditions, "(source_id = @project_id OR target_id = @project_id)")
			params["project_id"] = projectID
		}
	}
	if matchingNodeIDs != nil {
		nodeIDs := make([]string, 0, len(matchingNodeIDs))
		for nodeID := range matchingNodeIDs {
			nodeIDs = append(nodeIDs, nodeID)
		}
		sort.Strings(nodeIDs)
		if len(nodeIDs) == 0 {
			conditions = append(conditions, "FALSE")
		} else {
			conditions = append(conditions, "source_id IN UNNEST(@visible_node_ids) AND target_id IN UNNEST(@visible_node_ids)")
			params["visible_node_ids"] = nodeIDs
		}
	}
	return spanner.Statement{
		SQL:    "SELECT id, source_id, target_id, relationship, properties_json, provenance_json FROM encois_graph_edges WHERE " + strings.Join(conditions, " AND "),
		Params: params,
	}
}
