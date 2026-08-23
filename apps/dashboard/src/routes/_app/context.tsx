import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Database, Network, Save, ShieldCheck, Trash2 } from 'lucide-react'
import { KnowledgeSourceStatus, WorkflowExecutionStatus, type ExecutionScope, type GraphInspectionParams, type GraphInspectorQueryName, type GraphNode, type KnowledgeSource, type SavedInvestigation, type WorkflowExecutionProjection } from '@encois/contracts'
import { ContextGraphCanvas } from '@/components/context-graph-canvas'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createSavedInvestigation, deleteSavedInvestigation, isApiError, listKnowledgeSources, listSavedInvestigations, listWorkflows, queryContextGraph } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { useOrganization } from '@/lib/organization-context'
import { Permission } from '@encois/contracts'
import { useCan } from '@/lib/permissions'
import { ProductTerm } from '@/components/product-term'

export const Route = createFileRoute('/_app/context')({
  validateSearch: (search: Record<string, unknown>) => ({
    savedId: typeof search.savedId === 'string' ? search.savedId : undefined,
  }),
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.ContextRead)) throw redirect({ to: '/forbidden' })
  },
  component: ContextGraphPage,
})

const queryOptions: readonly { value: GraphInspectorQueryName; label: string; description: string }[] = [
  { value: 'all_context', label: 'All context', description: 'The current organization-scoped graph projection.' },
  { value: 'release.blockers', label: 'Release blockers', description: 'Blocked entities and their linked graph facts.' },
  { value: 'source.facts', label: 'Source facts', description: 'Facts projected from connected knowledge sources.' },
  { value: 'project.related_entities', label: 'Organization unit neighborhood', description: 'Entities directly related to a selected organization unit key.' },
]

function ContextGraphPage() {
  const { units } = useOrganization()
  const { savedId } = Route.useSearch()
  const queryClient = useQueryClient()
  const canViewSources = useCan(Permission.KnowledgeRead)
  const canViewWorkflows = useCan(Permission.WorkflowsRead)
  const [query, setQuery] = useState<GraphInspectorQueryName>('all_context')
  const [scope, setScope] = useState('all')
  const [savedScope, setSavedScope] = useState<ExecutionScope | undefined>()
  const [projectId, setProjectId] = useState('')
  const [nodeType, setNodeType] = useState('')
  const [relationship, setRelationship] = useState('')
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const selectedScope = scope === 'all' ? undefined : scope === 'saved' ? savedScope : { ids: [scope] }
  const graphParams: GraphInspectionParams = {
    ...(query === 'project.related_entities' && projectId.trim() ? { projectId: projectId.trim() } : {}),
    ...(nodeType.trim() ? { nodeType: nodeType.trim() } : {}),
    ...(relationship.trim() ? { relationship: relationship.trim() } : {}),
  }
  const [savedName, setSavedName] = useState('')
  const saved = useQuery({ queryKey: queryKeys.savedInvestigations(), queryFn: listSavedInvestigations })
  const saveInvestigation = useMutation({ mutationFn: () => createSavedInvestigation({ name: savedName.trim(), kind: 'graph', query, ...(Object.keys(graphParams).length ? { params: graphParams } : {}), scope: selectedScope ?? { ids: units.filter((unit) => unit.id !== 'organization').map((unit) => unit.id) } }), onSuccess: async () => { setSavedName(''); await queryClient.invalidateQueries({ queryKey: queryKeys.savedInvestigations() }) } })
  const removeInvestigation = useMutation({ mutationFn: (id: string) => deleteSavedInvestigation(id), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.savedInvestigations() }) } })
  const graph = useQuery({
    queryKey: queryKeys.contextGraph(query, scope, projectId, nodeType, relationship),
    queryFn: () => queryContextGraph({ query, ...(Object.keys(graphParams).length ? { params: graphParams } : {}), ...(selectedScope ? { scope: selectedScope } : {}) }),
    enabled: query !== 'project.related_entities' || projectId.trim().length > 0,
  })
  const sources = useQuery({ queryKey: queryKeys.sources(), queryFn: listKnowledgeSources, enabled: canViewSources })
  const workflows = useQuery({ queryKey: queryKeys.workflows(), queryFn: listWorkflows, enabled: canViewWorkflows })
  const selectedQuery = useMemo(() => queryOptions.find((option) => option.value === query), [query])
  const loadSavedInvestigation = useCallback((item: SavedInvestigation) => {
    if (item.kind !== 'graph') return
    const nextQuery = queryOptions.some((option) => option.value === item.query) ? item.query as GraphInspectorQueryName : 'all_context'
    const stringParam = (key: string) => typeof item.params[key] === 'string' ? item.params[key] as string : ''
    setQuery(nextQuery)
    setProjectId(nextQuery === 'project.related_entities' ? stringParam('projectId') : '')
    setNodeType(stringParam('nodeType'))
    setRelationship(stringParam('relationship'))
    setSavedScope(item.scope)
    setScope(item.scope.ids.length === 1 && units.some((unit) => unit.id === item.scope.ids[0]) ? item.scope.ids[0] : 'saved')
    setSelected(null)
  }, [units])
  const [loadedSavedId, setLoadedSavedId] = useState<string>()
  useEffect(() => {
    if (!savedId || loadedSavedId === savedId || !saved.data) return
    const item = saved.data.find((candidate) => candidate.id === savedId)
    if (item) loadSavedInvestigation(item)
    setLoadedSavedId(savedId)
  }, [loadSavedInvestigation, loadedSavedId, saved.data, savedId])

  return <div className="flex flex-col gap-8">
    <PageHeader title="Organization context" description={<>Inspect the scoped relationships and evidence that power <ProductTerm term="investigation" plural />. This read-only surface is backed by the <ProductTerm term="spannerGraph" /> projection and keeps <ProductTerm term="provenance" /> visible.</>} actions={<span className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" />Restricted surface</span>} />
    <ContextReadiness
      sources={sources.data}
      workflows={workflows.data}
      graph={graph.data}
      canViewSources={canViewSources}
      canViewWorkflows={canViewWorkflows}
      sourceUnavailable={sources.isError}
      workflowUnavailable={workflows.isError}
      graphUnavailable={graph.isError}
      sourceLoading={sources.isLoading}
      workflowLoading={workflows.isLoading}
      graphLoading={graph.isLoading}
    />
    <div className="flex items-start gap-3 rounded-lg border bg-background px-4 py-3 text-sm"><Database className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><p className="text-muted-foreground"><span className="font-medium text-foreground">Data source boundary.</span> Queries are allowlisted by Encois and scoped to the selected organization unit. Provider credentials never reach the browser.</p></div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="min-w-0">
        <CardHeader><CardTitle className="flex items-center gap-2"><Network className="size-4 text-muted-foreground" />Context map</CardTitle><CardDescription>{selectedQuery?.description}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1.5 text-xs font-medium"><ProductTerm term="query" /><select value={query} onChange={(event) => { setQuery(event.target.value as GraphInspectorQueryName); setSelected(null) }} className="h-9 rounded-md border bg-background px-3 text-sm font-normal"><option value="all_context">All context</option><option value="release.blockers">Release blockers</option><option value="source.facts">Source facts</option><option value="project.related_entities">Organization unit neighborhood</option></select></label>
            <label className="flex flex-1 flex-col gap-1.5 text-xs font-medium">Scope<select value={scope} onChange={(event) => { const value = event.target.value; setScope(value); if (value !== 'saved') setSavedScope(undefined); setSelected(null) }} className="h-9 rounded-md border bg-background px-3 text-sm font-normal"><option value="all">All available units</option>{scope === 'saved' && savedScope ? <option value="saved">Saved scope ({savedScope.ids.length} units)</option> : null}{units.filter((unit) => unit.id !== 'organization').map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
            {query === 'project.related_entities' ? <label className="flex flex-1 flex-col gap-1.5 text-xs font-medium">Organization unit key<input value={projectId} onChange={(event) => setProjectId(event.target.value)} placeholder="Organization unit id" maxLength={160} className="h-9 rounded-md border bg-background px-3 text-sm font-normal" /></label> : null}
            <label className="flex flex-1 flex-col gap-1.5 text-xs font-medium">Start node type <span className="font-normal text-muted-foreground">Optional · linked endpoints stay visible</span><input value={nodeType} onChange={(event) => setNodeType(event.target.value)} placeholder="e.g. service" maxLength={80} className="h-9 rounded-md border bg-background px-3 text-sm font-normal" /></label>
            <label className="flex flex-1 flex-col gap-1.5 text-xs font-medium">Relationship <span className="font-normal text-muted-foreground">Optional</span><input value={relationship} onChange={(event) => setRelationship(event.target.value)} placeholder="e.g. depends_on" maxLength={120} className="h-9 rounded-md border bg-background px-3 text-sm font-normal" /></label>
          </div>
          {graph.isLoading ? <div className="flex h-[560px] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">Loading graph projection…</div> : null}
          {graph.isError ? <EmptyPanel icon={CircleAlert} title={isApiError(graph.error) && graph.error.code === 'GRAPH_UNAVAILABLE' ? 'Organization context unavailable' : 'Context query failed'} description={graph.error.message} /> : null}
          {graph.data && graph.data.nodes.length === 0 ? <EmptyPanel icon={Network} title="No graph facts in this scope" description="The selected query returned no visible nodes. Ingest a Knowledge Source or widen the organization scope." /> : null}
          {graph.data && graph.data.nodes.length > 0 ? <ContextGraphCanvas graph={graph.data} onSelect={setSelected} /> : null}
        </CardContent>
      </Card>
          <div className="flex flex-col gap-4">
        <Card><CardHeader><CardTitle>Selected entity</CardTitle><CardDescription>Inspect normalized properties and <ProductTerm term="provenance" />.</CardDescription></CardHeader><CardContent>{selected ? <NodeInspector node={selected} /> : <p className="text-sm text-muted-foreground">Select a node in the graph to inspect it.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle><ProductTerm term="freshness" /></CardTitle><CardDescription>Data freshness returned by the graph boundary.</CardDescription></CardHeader><CardContent>{graph.data?.freshness?.length ? <div className="flex flex-col gap-2">{graph.data.freshness.map((item) => <div key={`${item.source}-${item.observedAt}`} className="flex items-center justify-between gap-3 text-sm"><span>{item.source}</span><span className="text-xs text-muted-foreground">{item.status}</span></div>)}</div> : <p className="text-sm text-muted-foreground">No freshness metadata returned.</p>}</CardContent></Card>
          <Card><CardHeader><CardTitle><ProductTerm term="investigation" plural /></CardTitle><CardDescription>Save this bounded graph query for repeatable review. Scope stays attached to the saved record.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3"><div className="flex gap-2"><input value={savedName} onChange={(event) => setSavedName(event.target.value)} placeholder="e.g. Release blockers" maxLength={120} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm" /><Button type="button" onClick={() => saveInvestigation.mutate()} disabled={!savedName.trim() || saveInvestigation.isPending}>{saveInvestigation.isPending ? 'Saving…' : <><Save data-icon="inline-start" />Save</>}</Button></div>{saveInvestigation.isError ? <p role="alert" className="text-xs text-destructive">Could not save: {saveInvestigation.error.message}</p> : null}{saved.isError ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">Saved investigations are unavailable: {saved.error.message}</p> : null}{removeInvestigation.isError ? <p role="alert" className="text-xs text-destructive">Could not delete the saved investigation: {removeInvestigation.error.message}</p> : null}{saved.data?.length ? <div className="flex flex-col gap-2">{saved.data.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-md border p-2 text-xs"><Button type="button" variant="ghost" className="min-w-0 flex-1 justify-start truncate px-1 text-left" onClick={() => loadSavedInvestigation(item)} disabled={item.kind !== 'graph'}>{item.name}</Button><span className="text-muted-foreground">{item.query}</span><Button type="button" variant="ghost" size="icon" aria-label={`Delete ${item.name}`} onClick={() => { if (window.confirm(`Delete saved investigation “${item.name}”? This cannot be undone.`)) removeInvestigation.mutate(item.id) }} disabled={removeInvestigation.isPending}><Trash2 className="size-3.5" /></Button></div>)}</div> : null}</CardContent></Card>
      </div>
    </div>
  </div>
}

function ContextReadiness({
  sources,
  workflows,
  graph,
  canViewSources,
  canViewWorkflows,
  sourceUnavailable,
  workflowUnavailable,
  graphUnavailable,
  sourceLoading,
  workflowLoading,
  graphLoading,
}: {
  sources?: readonly KnowledgeSource[]
  workflows?: readonly WorkflowExecutionProjection[]
  graph?: { nodes: readonly GraphNode[] }
  canViewSources: boolean
  canViewWorkflows: boolean
  sourceUnavailable: boolean
  workflowUnavailable: boolean
  graphUnavailable: boolean
  sourceLoading: boolean
  workflowLoading: boolean
  graphLoading: boolean
}) {
  const activeSources = sources?.filter((source) => source.status === KnowledgeSourceStatus.Active).length
  const staleSources = sources?.filter((source) => source.freshness?.status === 'stale' || source.status === KnowledgeSourceStatus.Degraded || source.status === KnowledgeSourceStatus.Failed).length
  const blockedRuns = workflows?.filter((workflow) => workflow.status === WorkflowExecutionStatus.Waiting || workflow.status === WorkflowExecutionStatus.Failed || workflow.status === WorkflowExecutionStatus.Partial).length
  const metric = (visible: boolean, value: number | undefined, unavailable: boolean, loading: boolean) => !visible || unavailable ? '—' : loading ? '…' : value === undefined ? '—' : String(value)
  const anyUnavailable = sourceUnavailable || workflowUnavailable || graphUnavailable

  return <Card className="border-primary/20 bg-primary/[0.02]"><CardHeader><CardTitle>Context readiness</CardTitle><CardDescription>Coverage and blockers for the current organization scope. A dash means the underlying permission or query did not provide that metric.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><ReadinessMetric label="Sources" value={metric(canViewSources, sources?.length, sourceUnavailable, sourceLoading)} detail={canViewSources && activeSources !== undefined ? `${activeSources} active` : sourceUnavailable ? 'Unavailable · reload page' : 'Access restricted'} /><ReadinessMetric label="Stale or degraded" value={metric(canViewSources, staleSources, sourceUnavailable, sourceLoading)} detail={sourceUnavailable ? 'Unavailable · reload page' : 'Needs source review'} /><ReadinessMetric label="Blocked Runs" value={metric(canViewWorkflows, blockedRuns, workflowUnavailable, workflowLoading)} detail={workflowUnavailable ? 'Unavailable · reload page' : 'Waiting, failed, or partial'} /><ReadinessMetric label="Visible entities" value={metric(true, graph?.nodes.length, graphUnavailable, graphLoading)} detail={graphUnavailable ? 'Unavailable · reload page' : 'Current graph query'} /></div><div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">Recommended review:</span>{!canViewSources ? <span className="rounded-full bg-secondary px-2 py-1">Knowledge Source access required</span> : sourceUnavailable ? <span className="rounded-full bg-destructive/10 px-2 py-1 text-destructive">Source readiness unavailable · reload the page</span> : sources?.length === 0 ? <Link to="/sources/new" className="rounded-full bg-secondary px-2 py-1 underline-offset-2 hover:underline">Add a Knowledge Source</Link> : staleSources ? <Link to="/sources" className="rounded-full bg-secondary px-2 py-1 underline-offset-2 hover:underline">Review stale Sources</Link> : null}{canViewWorkflows && workflowUnavailable ? <span className="rounded-full bg-destructive/10 px-2 py-1 text-destructive">Run readiness unavailable · reload the page</span> : canViewWorkflows && blockedRuns ? <Link to="/review" className="rounded-full bg-secondary px-2 py-1 underline-offset-2 hover:underline">Review blocked Runs</Link> : null}{graphUnavailable ? <span className="rounded-full bg-destructive/10 px-2 py-1 text-destructive">Graph entity count unavailable · reload the page</span> : null}{!anyUnavailable && canViewSources && sources?.length && !staleSources && !blockedRuns ? <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-700">No current readiness blockers</span> : null}</div></CardContent></Card>
}

function ReadinessMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-lg border bg-background p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div>
}

function NodeInspector({ node }: { node: GraphNode }) {
  return <div className="flex flex-col gap-3"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">{node.type}</p><p className="mt-1 break-all font-mono text-xs">{node.id}</p></div><dl className="divide-y rounded-lg border text-sm">{Object.entries(node.properties).map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)] gap-3 px-3 py-2"><dt className="break-words text-muted-foreground">{key}</dt><dd className="break-words">{typeof value === 'string' ? value : JSON.stringify(value)}</dd></div>)}</dl>{node.provenance ? <details className="rounded-lg border px-3 py-2 text-xs"><summary className="cursor-pointer font-medium">Provenance</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap text-muted-foreground">{JSON.stringify(node.provenance, null, 2)}</pre></details> : null}</div>
}
