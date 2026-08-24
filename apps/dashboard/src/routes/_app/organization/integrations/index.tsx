import { useMemo, useState } from 'react'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowUpRight, CheckCircle2, Github, Plus, PlugZap, Search } from 'lucide-react'
import { IntegrationStatus, Permission, type IntegrationProjection } from '@encois/contracts'
import { EmptyPanel } from '@/components/empty-panel'
import { ListCollection, ListFilter, ListMeta, ListPagination, ListSearch, ListSummary, ListToolbar, ListViewToggle, type ListViewMode } from '@/components/list-controls'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { listIntegrationsPage } from '@/lib/api'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { humanizeKey, shortIdentifier } from '@/lib/formatters'
import { useCan } from '@/lib/permissions'
import { useOrganization } from '@/lib/organization-context'
import { queryKeys } from '@/lib/query-keys'

const providerCatalog = [
  { key: 'github', name: 'GitHub', description: 'Repositories, pull requests, and delivery activity.', capabilities: ['code.read', 'pull-requests.read', 'activity.read'] },
  { key: 'gitlab', name: 'GitLab', description: 'Repositories, merge requests, and delivery activity.', capabilities: ['code.read', 'pull-requests.read', 'activity.read'] },
  { key: 'jira', name: 'Jira', description: 'Issues, projects, and operational activity.', capabilities: ['issues.read', 'activity.read'] },
  { key: 'linear', name: 'Linear', description: 'Issues and project execution context.', capabilities: ['issues.read', 'activity.read'] },
  { key: 'slack', name: 'Slack', description: 'Read-only message and activity context.', capabilities: ['messages.read', 'activity.read'] },
  { key: 'google-drive', name: 'Google Drive', description: 'Scoped documents for organization context.', capabilities: ['documents.read'] },
] as const

export const Route = createFileRoute('/_app/organization/integrations/')({
  validateSearch: (search: Record<string, unknown>) => ({ q: typeof search.q === 'string' ? search.q : undefined }),
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.IntegrationsRead)) throw redirect({ to: '/forbidden' })
  },
  component: IntegrationsPage,
})

const pageSize = 10

function IntegrationsPage() {
  const navigate = useNavigate()
  const { q } = Route.useSearch()
  const { organizationName, units, currentUnitId, members } = useOrganization()
  const selectedScopeUnitId = units.some((unit) => unit.id === currentUnitId) ? currentUnitId : undefined
  const currentUnit = units.find((unit) => unit.id === selectedScopeUnitId)
  const scopeLabel = currentUnit?.type === 'organization' ? organizationName ?? currentUnit.name : currentUnit?.name ?? 'current scope'
  const actor = members.find((member) => member.id === getAuthSession()?.userId)
  const canManage = useCan(Permission.IntegrationsManage) && (actor?.roleKey === 'organization_admin' || actor?.roleKey === 'admin')
  const [status, setStatus] = useState<IntegrationStatus | 'all'>('all')
  const [sort, setSort] = useState<'updated-desc' | 'updated-asc' | 'name-asc' | 'status'>('updated-desc')
  const [view, setView] = useState<ListViewMode>('grid')
  const integrations = useInfiniteQuery({
    queryKey: queryKeys.integrations(selectedScopeUnitId, q ?? '', status, sort),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listIntegrationsPage({ scopeUnitId: selectedScopeUnitId, query: q, status, sort, limit: pageSize, offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.pagination.hasMore ? lastPage.pagination.offset + lastPage.pagination.limit : undefined,
  })
  const items = useMemo(() => integrations.data?.pages.flatMap((page) => page.items) ?? [], [integrations.data])
  const total = integrations.data?.pages[0]?.pagination.total ?? 0
  const statuses = [{ value: 'all', label: 'All statuses' }, ...Object.values(IntegrationStatus).map((value) => ({ value, label: humanizeKey(value) }))]
  const sorts = [
    { value: 'updated-desc', label: 'Recently updated' },
    { value: 'updated-asc', label: 'Oldest updated' },
    { value: 'name-asc', label: 'Name' },
    { value: 'status', label: 'Status' },
  ] as const
  const visibleProviders = providerCatalog.filter((provider) => !q || [provider.key, provider.name, provider.description, ...provider.capabilities].some((value) => value.toLowerCase().includes(q.toLowerCase())))

  function updateQuery(value: string) {
    void navigate({ search: (current) => ({ ...current, q: value || undefined }) })
  }

  return <div className="flex flex-col gap-8">
    <PageHeader title={<ProductTerm term="integration" plural />} description={<>Organization-level provider integrations are available to authorized unit-scoped Sources. Current scope: {scopeLabel}.</>} actions={canManage ? <Button asChild><Link to="/organization/integrations/new"><Plus data-icon="inline-start" />Add integration</Link></Button> : <span className="text-xs text-muted-foreground">Read-only access</span>} />
    <div className="flex flex-col gap-3"><div><h2 className="text-lg font-semibold tracking-tight">Existing Integrations</h2><p className="text-sm text-muted-foreground">Configured provider connections visible in the current organization scope.</p></div><ListSummary items={[{ label: 'Available Integrations', value: integrations.isLoading ? '…' : String(total), detail: `Available in ${scopeLabel}` }, { label: 'Visible Integrations', value: integrations.isLoading ? '…' : String(items.length), detail: 'Loaded in this view' }, { label: 'Current scope', value: scopeLabel, detail: 'Access-aware results' }]} /></div>
    <ListToolbar>
      <ListSearch value={q ?? ''} onChange={updateQuery} placeholder="Search Integrations by provider or name…" label="Search Integrations" />
      <ListFilter value={status} onChange={(value) => setStatus(value as IntegrationStatus | 'all')} options={statuses} label="Filter Integrations by status" />
      <ListFilter value={sort} onChange={(value) => setSort(value as typeof sort)} options={sorts} label="Sort Integrations" />
      <ListViewToggle value={view} onChange={setView} />
      <ListMeta>{items.length} loaded · {total} available</ListMeta>
    </ListToolbar>
    {integrations.isLoading ? <p className="text-sm text-muted-foreground">Loading Integrations…</p> : null}
    {integrations.isError ? <Card><CardContent className="pt-6"><p role="alert" className="text-sm text-destructive">Could not load Integrations: {integrations.error.message}</p></CardContent></Card> : null}
    {!integrations.isLoading && !integrations.isError && items.length ? <ListCollection items={items} view={view} getKey={(integration) => integration.id} renderItem={(integration) => <IntegrationPreviewCard integration={integration} view={view} />} /> : null}
    {!integrations.isLoading && !integrations.isError && !items.length ? <Card><CardContent className="pt-6"><EmptyPanel icon={q || status !== 'all' ? Search : PlugZap} title={q || status !== 'all' ? 'No Integrations match' : <>No Integrations in {scopeLabel}{currentUnit?.type === 'organization' ? '' : ' scope'}</>} description={q || status !== 'all' ? 'Change the search or status filter.' : `No connected Integrations are available in ${scopeLabel}${currentUnit?.type === 'organization' ? '' : ' scope'}.`} /></CardContent></Card> : null}
    {!integrations.isLoading && !integrations.isError && items.length ? <ListPagination hasMore={Boolean(integrations.hasNextPage)} loading={integrations.isFetchingNextPage} onLoadMore={() => void integrations.fetchNextPage()} /> : null}
    {canManage ? <section className="flex flex-col gap-4"><div><h2 className="text-lg font-semibold tracking-tight">Integration Catalog</h2><p className="text-sm text-muted-foreground">Provider credentials and permissions are configured once for the organization. Add Jira projects, repositories, or channels as Sources in their organization unit.</p></div><ListToolbar><ListSearch value={q ?? ''} onChange={updateQuery} placeholder="Search the Integration Catalog…" label="Search Integration Catalog" /><ListMeta>{visibleProviders.length} providers</ListMeta></ListToolbar>{visibleProviders.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleProviders.map((provider) => { const connected = items.filter((integration) => integration.provider.toLowerCase() === provider.key); return <Card key={provider.key}><CardHeader className="flex flex-row items-start justify-between gap-3"><div><CardTitle className="text-base">{provider.name}</CardTitle><CardDescription>{provider.description}</CardDescription></div><span className="rounded-full bg-secondary px-2 py-1 text-[11px] text-secondary-foreground">{connected.length ? `${connected.length} registered` : 'Available'}</span></CardHeader><CardContent className="flex flex-col gap-4"><p className="text-[11px] text-muted-foreground">Read capabilities: {provider.capabilities.join(' · ')}</p><Button variant="outline" size="sm" asChild><Link to="/organization/integrations/new" search={{ provider: provider.key }}>Register {provider.name}</Link></Button></CardContent></Card>})}</div> : <Card><CardContent className="pt-6"><EmptyPanel icon={Search} title="No integrations match" description="Change the provider or capability search." /></CardContent></Card>}</section> : null}
  </div>
}

function IntegrationPreviewCard({ integration, view }: { integration: IntegrationProjection; view: ListViewMode }) {
  const Icon = integration.provider.toLowerCase() === 'github' ? Github : PlugZap
  return <Link to="/organization/integrations/$integrationId" params={{ integrationId: integration.id }} className="group block"><Card className={view === 'list' ? 'transition-colors group-hover:border-foreground/30 md:flex md:items-center md:justify-between' : 'h-full transition-colors group-hover:border-foreground/30'}><CardHeader className="flex flex-row items-start justify-between gap-4"><div className="flex items-start gap-3"><span className="flex size-9 items-center justify-center rounded-md border bg-muted/30"><Icon className="size-4 text-muted-foreground" aria-hidden="true" /></span><div className="flex flex-col gap-1.5"><CardTitle>{integration.name}</CardTitle><CardDescription>{integration.provider}</CardDescription></div></div><ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" /></CardHeader><CardContent className="flex items-center gap-2 text-xs text-muted-foreground">{integration.status === IntegrationStatus.Active ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <PlugZap className="size-3.5" aria-hidden="true" />}<span>{humanizeKey(integration.status)}</span><span className="ml-auto">Technical ID: <span className="font-mono">{shortIdentifier(integration.id)}</span></span></CardContent></Card></Link>
}
