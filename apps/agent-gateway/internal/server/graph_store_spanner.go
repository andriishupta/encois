package server

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"cloud.google.com/go/spanner"
	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
	contracts "github.com/andriishupta/encois/packages/contracts"
	"google.golang.org/api/iterator"
)

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
	if err := validateGraphMutation(mutation); err != nil {
		return err
	}
	mutations := make([]*spanner.Mutation, 0, len(mutation.Nodes)+len(mutation.Edges))
	for _, node := range mutation.Nodes {
		properties, err := graphJSONValue(node.Properties, "graph node properties")
		if err != nil {
			return err
		}
		provenance, err := graphJSONValue(node.Provenance, "graph node provenance")
		if err != nil {
			return err
		}
		mutations = append(mutations, spanner.InsertOrUpdate("encois_graph_nodes",
			[]string{"organization_id", "id", "type", "properties_json", "provenance_json"},
			[]any{mutation.OrganizationID, node.ID, node.Type, properties, provenance}))
	}
	for _, edge := range mutation.Edges {
		properties, err := graphJSONValue(edge.Properties, "graph edge properties")
		if err != nil {
			return err
		}
		provenance, err := graphJSONValue(edge.Provenance, "graph edge provenance")
		if err != nil {
			return err
		}
		mutations = append(mutations, spanner.InsertOrUpdate("encois_graph_edges",
			[]string{"organization_id", "id", "source_id", "target_id", "relationship", "properties_json", "provenance_json"},
			[]any{mutation.OrganizationID, edge.ID, edge.SourceID, edge.TargetID, edge.Relationship, properties, provenance}))
	}
	if len(mutations) == 0 {
		return nil
	}
	_, err := s.client.Apply(ctx, mutations)
	return err
}

func (s *spannerGraphStore) Query(ctx context.Context, request domain.GraphQueryRequest) (domain.GraphQueryResponse, error) {
	if err := validateGraphQuery(request); err != nil {
		return domain.GraphQueryResponse{}, err
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
	var id, typ string
	var propertiesJSON, provenanceJSON spanner.NullJSON
	if err := row.Columns(&id, &typ, &propertiesJSON, &provenanceJSON); err != nil {
		return domain.GraphNode{}, err
	}
	var properties map[string]any
	if err := decodeGraphJSON(propertiesJSON, &properties); err != nil {
		return domain.GraphNode{}, err
	}
	provenance, err := graphProvenance(provenanceJSON)
	if err != nil {
		return domain.GraphNode{}, err
	}
	return domain.GraphNode{ID: id, Type: typ, Properties: properties, Provenance: provenance}, nil
}

func graphEdgeFromRow(row *spanner.Row) (domain.GraphEdge, error) {
	var id, sourceID, targetID, relationship string
	var propertiesJSON, provenanceJSON spanner.NullJSON
	if err := row.Columns(&id, &sourceID, &targetID, &relationship, &propertiesJSON, &provenanceJSON); err != nil {
		return domain.GraphEdge{}, err
	}
	var properties map[string]any
	if err := decodeGraphJSON(propertiesJSON, &properties); err != nil {
		return domain.GraphEdge{}, err
	}
	provenance, err := graphProvenance(provenanceJSON)
	if err != nil {
		return domain.GraphEdge{}, err
	}
	return domain.GraphEdge{ID: id, SourceID: sourceID, TargetID: targetID, Relationship: relationship, Properties: properties, Provenance: provenance}, nil
}

func graphJSONValue(value any, label string) (spanner.NullJSON, error) {
	if _, err := json.Marshal(value); err != nil {
		return spanner.NullJSON{}, fmt.Errorf("encode %s: %w", label, err)
	}
	return spanner.NullJSON{Value: value, Valid: true}, nil
}

func decodeGraphJSON(value spanner.NullJSON, target any) error {
	if !value.Valid {
		return nil
	}
	encoded, err := json.Marshal(value.Value)
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, target)
}

func graphProvenance(value spanner.NullJSON) (*contracts.DataProvenance, error) {
	if !value.Valid || value.Value == nil {
		return nil, nil
	}
	provenance := &contracts.DataProvenance{}
	if err := decodeGraphJSON(value, provenance); err != nil {
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
	return spanner.Statement{SQL: "SELECT id, type, properties_json, provenance_json FROM encois_graph_nodes WHERE " + strings.Join(conditions, " AND "), Params: params}
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
	nodeIDs := sortedGraphIDs(endpointNodeIDs)
	if len(nodeIDs) == 0 {
		conditions = append(conditions, "FALSE")
	} else {
		conditions = append(conditions, "(source_id IN UNNEST(@endpoint_node_ids) OR target_id IN UNNEST(@endpoint_node_ids))")
		params["endpoint_node_ids"] = nodeIDs
	}
	return spanner.Statement{SQL: "SELECT id, source_id, target_id, relationship, properties_json, provenance_json FROM encois_graph_edges WHERE " + strings.Join(conditions, " AND "), Params: params}
}

func graphNeighborNodesStatement(request domain.GraphQueryRequest, nodeIDs map[string]struct{}) spanner.Statement {
	conditions := []string{"organization_id = @organization_id"}
	params := map[string]any{"organization_id": request.OrganizationID}
	ids := sortedGraphIDs(nodeIDs)
	if len(ids) == 0 {
		conditions = append(conditions, "FALSE")
	} else {
		conditions = append(conditions, "id IN UNNEST(@neighbor_node_ids)")
		params["neighbor_node_ids"] = ids
	}
	return spanner.Statement{SQL: "SELECT id, type, properties_json, provenance_json FROM encois_graph_nodes WHERE " + strings.Join(conditions, " AND "), Params: params}
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
		nodeIDs := sortedGraphIDs(matchingNodeIDs)
		if len(nodeIDs) == 0 {
			conditions = append(conditions, "FALSE")
		} else {
			conditions = append(conditions, "source_id IN UNNEST(@visible_node_ids) AND target_id IN UNNEST(@visible_node_ids)")
			params["visible_node_ids"] = nodeIDs
		}
	}
	return spanner.Statement{SQL: "SELECT id, source_id, target_id, relationship, properties_json, provenance_json FROM encois_graph_edges WHERE " + strings.Join(conditions, " AND "), Params: params}
}

func sortedGraphIDs(values map[string]struct{}) []string {
	ids := make([]string, 0, len(values))
	for id := range values {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
