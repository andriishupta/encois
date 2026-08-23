import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, FileText, Plus, RefreshCw, Search, Waypoints } from 'lucide-react'
import { KnowledgeSourceKind, KnowledgeSourceStatus, type KnowledgeSource } from '@encois/contracts'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { listKnowledgeSources } from '@/lib/api'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { Permission } from '@encois/contracts'
import { queryKeys } from '@/lib/query-keys'
import { humanizeKey } from '@/lib/formatters'
import { formatUnitPath } from '@/lib/organization'
import { useOrganization } from '@/lib/organization-context'

export const Route = createFileRoute('/_app/sources/')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.KnowledgeRead)) throw redirect({ to: '/forbidden' })
  },
  component: SourcesPage,
})

function SourcesPage() {
  const { units } = useOrganization()
  const sources = useQuery({ queryKey: queryKeys.sources(), queryFn: listKnowledgeSources })
  const canManageKnowledgeSources = hasPermission(getAuthSession(), Permission.KnowledgeManage)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<KnowledgeSourceStatus | 'all'>('all')
  const [provider, setProvider] = useState('all')
  const [kind, setKind] = useState<KnowledgeSourceKind | 'all'>('all')
  const [scope, setScope] = useState('all')
  const [freshness, setFreshness] = useState('all')
  const providerOptions = [...new Set((sources.data ?? []).map((source) => source.provider).filter((value): value is string => Boolean(value)))].sort()
  const scopeOptions = [...new Set((sources.data ?? []).flatMap((source) => source.readScope.ids))].sort().map((value) => ({ value, label: formatUnitPath(units, value) || value }))
  const freshnessOptions = [...new Set((sources.data ?? []).map((source) => source.freshness?.status).filter((value): value is NonNullable<typeof value> => Boolean(value)))].sort()
  const filteredSources = (sources.data ?? []).filter((source) => {
    const normalizedQuery = query.trim().toLowerCase()
    const matchesQuery = !normalizedQuery || [source.name, source.provider, source.kind].some((value) => value?.toLowerCase().includes(normalizedQuery))
    const matchesProvider = provider === 'all' || source.provider === provider
    const matchesKind = kind === 'all' || source.kind === kind
    const matchesScope = scope === 'all' || source.readScope.ids.includes(scope) || source.visibilityScope.ids.includes(scope)
    const matchesFreshness = freshness === 'all' || source.freshness?.status === freshness
    return matchesQuery && (status === 'all' || source.status === status) && matchesProvider && matchesKind && matchesScope && matchesFreshness
  })

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={<ProductTerm term="knowledgeSource" plural />}
        description={<>The scoped inputs Encois can ingest into project context. <ProductTerm term="integration" plural /> are one source type; documents and manual inputs use the same pipeline.</>}
        actions={canManageKnowledgeSources ? <Button asChild><Link to="/sources/new"><Plus data-icon="inline-start" />Add source</Link></Button> : <span className="text-xs text-muted-foreground">Read-only access</span>}
      />
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Sources by name or provider…" aria-label="Search knowledge sources" className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50" /></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <select value={provider} onChange={(event) => setProvider(event.target.value)} aria-label="Filter sources by provider" className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><option value="all">All providers</option>{providerOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
            <select value={kind} onChange={(event) => setKind(event.target.value as KnowledgeSourceKind | 'all')} aria-label="Filter sources by type" className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><option value="all">All types</option>{Object.values(KnowledgeSourceKind).map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select>
            <select value={scope} onChange={(event) => setScope(event.target.value)} aria-label="Filter sources by scope" className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><option value="all">All scopes</option>{scopeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            <select value={freshness} onChange={(event) => setFreshness(event.target.value)} aria-label="Filter sources by freshness" className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><option value="all">All freshness</option>{freshnessOptions.map((value) => <option key={value} value={value}>{humanizeKey(value)}</option>)}</select>
            <select value={status} onChange={(event) => setStatus(event.target.value as KnowledgeSourceStatus | 'all')} aria-label="Filter sources by status" className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><option value="all">All statuses</option>{Object.values(KnowledgeSourceStatus).map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select>
          </div>
          <span className="text-xs text-muted-foreground">{filteredSources.length} visible Sources</span>
        </CardContent>
      </Card>
      {sources.isLoading ? <p className="text-sm text-muted-foreground">Loading sources…</p> : null}
      {sources.isError ? <Card><CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-destructive">Could not load <ProductTerm term="knowledgeSource" plural />: {sources.error.message}</p><Button type="button" variant="outline" onClick={() => void sources.refetch()}><RefreshCw data-icon="inline-start" />Retry</Button></CardContent></Card> : null}
      {filteredSources.length ? <div className="grid gap-4 md:grid-cols-2">{filteredSources.map((source) => <SourceCard key={source.id} source={source} />)}</div> : null}
      {!sources.isLoading && !sources.isError && Boolean(sources.data?.length) && !filteredSources.length ? <Card><CardContent className="pt-6"><EmptyPanel icon={Search} title="No Sources match" description="Change the search or status filter." /></CardContent></Card> : null}
      {!sources.isLoading && !sources.isError && !sources.data?.length ? <Card>
        <CardContent className="pt-6">
        <EmptyPanel icon={Waypoints} title={<>No <ProductTerm term="knowledgeSource" plural /> yet</>} description={<>Upload a project PDF or connect a provider. Encois needs at least one scoped source before the <ProductTerm term="coordinator" /> can build useful context.</>} action={canManageKnowledgeSources ? <Button asChild><Link to="/sources/new"><Plus data-icon="inline-start" />Add your first source</Link></Button> : <span className="text-sm text-muted-foreground">Ask an organization administrator to add the first source.</span>} />
        </CardContent>
      </Card> : null}
    </div>
  )
}

function SourceCard({ source }: { source: KnowledgeSource }) {
  const Icon = source.kind === KnowledgeSourceKind.UploadedDocument ? FileText : Waypoints
  const statusLabel = source.status === KnowledgeSourceStatus.Ingesting ? 'Ingesting' : source.status.replace('_', ' ')
  const freshnessLabel = source.freshness?.status ? humanizeKey(source.freshness.status) : 'Freshness unavailable'
  return (
    <Link to="/sources/$sourceId" params={{ sourceId: source.id }} className="group">
      <Card className="h-full transition-colors group-hover:border-foreground/30">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/30"><Icon className="size-4 text-muted-foreground" aria-hidden="true" /></span>
            <div className="min-w-0"><CardTitle className="truncate">{source.name}</CardTitle><CardDescription className="mt-1">{source.provider ?? source.contentType ?? source.kind}</CardDescription></div>
          </div>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-1 text-secondary-foreground"><RefreshCw className="size-3" aria-hidden="true" />{statusLabel}</span>
          <span className={source.freshness?.status === 'stale' ? 'rounded-full bg-amber-500/10 px-2 py-1 text-amber-700' : 'rounded-full bg-muted px-2 py-1'}>{freshnessLabel}</span>
          <span className="ml-auto truncate font-mono">{source.currentRevisionId ? 'revision ready' : 'no revision'}</span>
        </CardContent>
      </Card>
    </Link>
  )
}
