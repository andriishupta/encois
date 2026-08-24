import { getAuthSession } from '@/lib/auth'

export function currentOrganizationId(): string | undefined {
  return getAuthSession()?.organizationId
}

export const queryKeys = {
  workflows: () => ['workflows', currentOrganizationId()] as const,
  workflowTemplates: (query = '') => ['workflow-templates', currentOrganizationId(), query] as const,
  workflowBlueprints: () => ['workflow-blueprints', currentOrganizationId()] as const,
  workflowPlans: () => ['workflow-plans', currentOrganizationId()] as const,
  workflowPlannerVersions: () => ['workflow-planner-versions', currentOrganizationId()] as const,
  workflow: (workflowId: string) => ['workflow', currentOrganizationId(), workflowId] as const,
  workflowEvents: (workflowId: string) => ['workflow-events', currentOrganizationId(), workflowId] as const,
  workflowActivity: () => ['workflow-activity', currentOrganizationId()] as const,
  integrations: (scopeUnitId?: string) => scopeUnitId ? ['integrations', currentOrganizationId(), scopeUnitId] as const : ['integrations', currentOrganizationId()] as const,
  webhookEndpoint: (integrationId: string) => ['webhook-endpoint', currentOrganizationId(), integrationId] as const,
  sources: (scopeUnitId?: string) => scopeUnitId ? ['sources', currentOrganizationId(), scopeUnitId] as const : ['sources', currentOrganizationId()] as const,
  source: (sourceId: string) => ['source', currentOrganizationId(), sourceId] as const,
  organization: () => ['organization', currentOrganizationId()] as const,
  organizationAccessRequests: () => ['organization-access-requests', currentOrganizationId()] as const,
  contextGraph: (query: string, scope = '', projectId = '', nodeType = '', relationship = '') => ['context-graph', currentOrganizationId(), query, scope, projectId, nodeType, relationship] as const,
  agentMemory: (agentDefinition: string, query: string, scope = '', projectId = '') => ['agent-memory', currentOrganizationId(), agentDefinition, query, scope, projectId] as const,
  memoryChanges: () => ['memory-changes', currentOrganizationId()] as const,
  savedInvestigations: () => ['saved-investigations', currentOrganizationId()] as const,
  notifications: () => ['notifications', currentOrganizationId()] as const,
  recommendations: () => ['recommendations', currentOrganizationId()] as const,
  notificationPreferences: () => ['notification-preferences', currentOrganizationId()] as const,
} as const
