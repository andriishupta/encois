import { getAuthSession } from '@/lib/auth'

export function currentOrganizationId(): string | undefined {
  return getAuthSession()?.organizationId
}

export const queryKeys = {
  workflows: () => ['workflows', currentOrganizationId()] as const,
  workflow: (workflowId: string) => ['workflow', currentOrganizationId(), workflowId] as const,
  integrations: () => ['integrations', currentOrganizationId()] as const,
  sources: () => ['knowledge-sources', currentOrganizationId()] as const,
  source: (sourceId: string) => ['knowledge-source', currentOrganizationId(), sourceId] as const,
  organization: () => ['organization', currentOrganizationId()] as const,
} as const
