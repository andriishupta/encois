import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, CheckCircle2, Github, Plus, PlugZap, Search } from 'lucide-react'
import { IntegrationStatus, type IntegrationProjection } from '@encois/contracts'
import { PageHeader } from '@/components/page-header'
import { EmptyPanel } from '@/components/empty-panel'
import { ProductTerm } from '@/components/product-term'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { listIntegrations } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { Permission } from '@encois/contracts'
import { useCan } from '@/lib/permissions'
import { humanizeKey, shortIdentifier } from '@/lib/formatters'
import { useOrganization } from '@/lib/organization-context'

const providerCatalog = [
  { key: 'github', name: 'GitHub', description: 'Repositories, pull requests, and delivery activity.', capabilities: ['code.read', 'pull-requests.read', 'activity.read'] },
  { key: 'gitlab', name: 'GitLab', description: 'Repositories, merge requests, and delivery activity.', capabilities: ['code.read', 'pull-requests.read', 'activity.read'] },
  { key: 'jira', name: 'Jira', description: 'Issues, projects, and operational activity.', capabilities: ['issues.read', 'activity.read'] },
  { key: 'linear', name: 'Linear', description: 'Issues and project execution context.', capabilities: ['issues.read', 'activity.read'] },
  { key: 'slack', name: 'Slack', description: 'Read-only message and activity context.', capabilities: ['messages.read', 'activity.read'] },
  { key: 'google-drive', name: 'Google Drive', description: 'Scoped documents for organization context.', capabilities: ['documents.read'] },
] as const

export const Route = createFileRoute('/_app/organization/integrations/')({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === 'string' ? search.q : undefined,
  }),
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.IntegrationsRead)) throw redirect({ to: '/forbidden' })
  },
  component: IntegrationsPage,
})

function IntegrationsPage() {
  const navigate = useNavigate()
  const { q } = Route.useSearch()
  const { organizationName, units, currentUnitId, members } = useOrganization()
  const selectedScopeUnitId = units.some((unit) => unit.id === currentUnitId) ? currentUnitId : undefined
  const currentUnit = units.find((unit) => unit.id === selectedScopeUnitId)
  const scopeLabel = currentUnit?.type === 'organization' ? organizationName ?? currentUnit.name : currentUnit?.name ?? 'current scope'
  const integrations = useQuery({ queryKey: queryKeys.integrations(selectedScopeUnitId), queryFn: () => listIntegrations({ scopeUnitId: selectedScopeUnitId }) })
  const actor = members.find((member) => member.id === getAuthSession()?.userId)
  const canManage = useCan(Permission.IntegrationsManage) && (actor?.roleKey === 'organization_admin' || actor?.roleKey === 'admin')
  const query = q?.trim().toLowerCase() ?? ''
  const visibleProviders = providerCatalog.filter((provider) => !query || [provider.key, provider.name, provider.description, ...provider.capabilities].some((value) => value.toLowerCase().includes(query)))

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={<ProductTerm term="integration" plural />}
        description={<>Organization-level provider integrations are available to authorized unit-scoped Sources. Current scope: {scopeLabel}.</>}
        actions={canManage ? <Button asChild><Link to="/organization/integrations/new"><Plus data-icon="inline-start" />Add integration</Link></Button> : <span className="text-xs text-muted-foreground">Read-only access</span>}
      />
      {integrations.isLoading ? <p className="text-sm text-muted-foreground">Loading integrations…</p> : null}
      {integrations.isError ? <Card><CardContent className="pt-6"><p role="alert" className="text-sm text-destructive">Could not load integrations: {integrations.error.message}</p></CardContent></Card> : null}
      {integrations.data?.length ? <div className="grid gap-4 md:grid-cols-2">{integrations.data.map((integration) => <IntegrationPreviewCard key={integration.id} integration={integration} />)}</div> : null}
      {!integrations.isLoading && !integrations.isError && !integrations.data?.length ? <Card>
        <CardContent className="pt-6">
          <EmptyPanel icon={PlugZap} title={<>No <ProductTerm term="integration" plural /> in {scopeLabel}{currentUnit?.type === 'organization' ? '' : ' scope'}</>} description={<>No connected integrations are available in {scopeLabel}{currentUnit?.type === 'organization' ? '' : ' scope'}.</>} />
        </CardContent>
      </Card> : null}
      {canManage ? <Card>
        <CardHeader>
          <CardTitle>Integration catalog</CardTitle>
          <CardDescription>Provider credentials and permissions are configured once for the organization. Add Jira projects, repositories, or channels as Sources in their organization unit.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="relative max-w-xl"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input value={q ?? ''} onChange={(event) => { void navigate({ search: (current) => ({ ...current, q: event.target.value || undefined }) }) }} placeholder="Search integrations by provider or capability…" aria-label="Search integration catalog" className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50" /></div>
          {visibleProviders.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleProviders.map((provider) => {
            const connected = integrations.data?.filter((integration) => integration.provider.toLowerCase() === provider.key) ?? []
            return <div key={provider.key} className="rounded-lg border p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{provider.name}</p><p className="mt-1 text-xs text-muted-foreground">{provider.description}</p></div><span className="rounded-full bg-secondary px-2 py-1 text-[11px] text-secondary-foreground">{connected.length ? `${connected.length} registered` : 'Available'}</span></div><p className="mt-3 text-[11px] text-muted-foreground">Read capabilities: {provider.capabilities.join(' · ')}</p><Button className="mt-4" variant="outline" size="sm" asChild><Link to="/organization/integrations/new" search={{ provider: provider.key }}>Register {provider.name}</Link></Button></div>
          })}
          </div> : <EmptyPanel icon={Search} title="No integrations match" description="Change the provider or capability search." />}
        </CardContent>
      </Card> : null}
    </div>
  )
}

function IntegrationPreviewCard({
  integration,
}: {
  integration: IntegrationProjection
}) {
  const Icon = integration.provider.toLowerCase() === 'github' ? Github : PlugZap
  return (
    <Link to="/organization/integrations/$integrationId" params={{ integrationId: integration.id }} className="group">
      <Card className="h-full transition-colors group-hover:border-foreground/30">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 items-center justify-center rounded-md border bg-muted/30"><Icon className="size-4 text-muted-foreground" aria-hidden="true" /></span>
              <div className="flex flex-col gap-1.5"><CardTitle>{integration.name}</CardTitle><CardDescription>{integration.provider}</CardDescription></div>
          </div>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
        </CardHeader>
          <CardContent className="flex items-center gap-2 text-xs text-muted-foreground">
          {integration.status === IntegrationStatus.Active ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <PlugZap className="size-3.5" aria-hidden="true" />}<span>{humanizeKey(integration.status)}</span><span className="ml-auto">Technical ID: <span className="font-mono">{shortIdentifier(integration.id)}</span></span>
        </CardContent>
      </Card>
    </Link>
  )
}
