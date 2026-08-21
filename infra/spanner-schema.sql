CREATE TABLE encois_graph_nodes (
  organization_id STRING(36) NOT NULL,
  id STRING(256) NOT NULL,
  type STRING(128) NOT NULL,
  properties_json JSON NOT NULL,
  provenance_json JSON NOT NULL,
) PRIMARY KEY (organization_id, id);

CREATE TABLE encois_graph_edges (
  organization_id STRING(36) NOT NULL,
  id STRING(256) NOT NULL,
  source_id STRING(256) NOT NULL,
  target_id STRING(256) NOT NULL,
  relationship STRING(128) NOT NULL,
  properties_json JSON NOT NULL,
  provenance_json JSON NOT NULL,
) PRIMARY KEY (organization_id, id);
