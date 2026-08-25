import { getAuthSession } from "@/lib/auth";

export function currentOrganizationId(): string | undefined {
  return getAuthSession()?.organizationId;
}

export const queryKeys = {
  workflows: () => ["workflows", currentOrganizationId()] as const,
  workflowRunList: (query = "", status = "all") =>
    ["workflow-run-list", currentOrganizationId(), query, status] as const,
  workflowRunListRoot: () =>
    ["workflow-run-list", currentOrganizationId()] as const,
  workflowTemplates: (query = "", status = "all", sort = "updated-desc") =>
    [
      "workflow-templates",
      currentOrganizationId(),
      query,
      status,
      sort,
    ] as const,
  workflowTemplatePages: (query = "", status = "all", sort = "updated-desc") =>
    [
      "workflow-templates",
      currentOrganizationId(),
      "__pages__",
      query,
      status,
      sort,
    ] as const,
  workflowBlueprints: (query = "", status = "all", sort = "updated-desc") =>
    [
      "workflow-blueprints",
      currentOrganizationId(),
      query,
      status,
      sort,
    ] as const,
  workflowBlueprintsRoot: () =>
    ["workflow-blueprints", currentOrganizationId()] as const,
  workflowBlueprintPages: (query = "", status = "all", sort = "updated-desc") =>
    [
      "workflow-blueprints",
      currentOrganizationId(),
      "__pages__",
      query,
      status,
      sort,
    ] as const,
  workflowPlans: (query = "", status = "all", sort = "updated-desc") =>
    ["workflow-plans", currentOrganizationId(), query, status, sort] as const,
  workflowPlansRoot: () => ["workflow-plans", currentOrganizationId()] as const,
  workflowPlan: (planId: string) =>
    ["workflow-plan", currentOrganizationId(), planId] as const,
  workflowPlanPages: (query = "", status = "all", sort = "updated-desc") =>
    [
      "workflow-plans",
      currentOrganizationId(),
      "__pages__",
      query,
      status,
      sort,
    ] as const,
  workflowPlannerVersions: () =>
    ["workflow-planner-versions", currentOrganizationId()] as const,
  workflow: (workflowId: string) =>
    ["workflow", currentOrganizationId(), workflowId] as const,
  workflowEvents: (workflowId: string) =>
    ["workflow-events", currentOrganizationId(), workflowId] as const,
  workflowActivity: () =>
    ["workflow-activity", currentOrganizationId()] as const,
  integrations: (
    scopeUnitId?: string,
    query = "",
    status = "all",
    sort = "updated-desc",
  ) =>
    scopeUnitId === undefined &&
    query === "" &&
    status === "all" &&
    sort === "updated-desc"
      ? (["integrations", currentOrganizationId()] as const)
      : ([
          "integrations",
          currentOrganizationId(),
          scopeUnitId ?? "all",
          query,
          status,
          sort,
        ] as const),
  integrationPages: (
    scopeUnitId?: string,
    query = "",
    status = "all",
    sort = "updated-desc",
  ) =>
    [
      "integrations",
      currentOrganizationId(),
      "__pages__",
      scopeUnitId ?? "all",
      query,
      status,
      sort,
    ] as const,
  integrationsRoot: () => ["integrations", currentOrganizationId()] as const,
  integrationCatalog: (
    channel = "api",
    type = "all",
    query = "",
    status = "all",
    sort = "updated-desc",
  ) =>
    [
      "integration-catalog",
      currentOrganizationId(),
      channel,
      type,
      query,
      status,
      sort,
    ] as const,
  webhookEndpoint: (integrationId: string) =>
    ["webhook-endpoint", currentOrganizationId(), integrationId] as const,
  sources: (
    scopeUnitId?: string,
    query = "",
    status = "all",
    sort = "updated-desc",
  ) =>
    scopeUnitId === undefined &&
    query === "" &&
    status === "all" &&
    sort === "updated-desc"
      ? (["sources", currentOrganizationId()] as const)
      : ([
          "sources",
          currentOrganizationId(),
          scopeUnitId ?? "all",
          query,
          status,
          sort,
        ] as const),
  sourcePages: (
    scopeUnitId?: string,
    query = "",
    status = "all",
    sort = "updated-desc",
  ) =>
    [
      "sources",
      currentOrganizationId(),
      "__pages__",
      scopeUnitId ?? "all",
      query,
      status,
      sort,
    ] as const,
  sourcesRoot: () => ["sources", currentOrganizationId()] as const,
  source: (sourceId: string) =>
    ["source", currentOrganizationId(), sourceId] as const,
  organization: () => ["organization", currentOrganizationId()] as const,
  organizationAccessRequests: () =>
    ["organization-access-requests", currentOrganizationId()] as const,
  contextGraph: (
    query: string,
    scope = "",
    projectId = "",
    nodeType = "",
    relationship = "",
  ) =>
    [
      "context-graph",
      currentOrganizationId(),
      query,
      scope,
      projectId,
      nodeType,
      relationship,
    ] as const,
  agentMemory: (
    agentDefinition: string,
    query: string,
    scope = "",
  ) =>
    [
      "agent-memory",
      currentOrganizationId(),
      agentDefinition,
      query,
      scope,
    ] as const,
  memoryChanges: () => ["memory-changes", currentOrganizationId()] as const,
  savedInvestigations: () =>
    ["saved-investigations", currentOrganizationId()] as const,
  notifications: () => ["notifications", currentOrganizationId()] as const,
  recommendations: () => ["recommendations", currentOrganizationId()] as const,
  notificationPreferences: () =>
    ["notification-preferences", currentOrganizationId()] as const,
} as const;
