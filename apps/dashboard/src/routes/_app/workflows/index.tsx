import { useMemo, useState } from 'react'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FilePlus2, GitBranch, Play, Search } from 'lucide-react'
import type { WorkflowBlueprintProjection, WorkflowBlueprintStatus, WorkflowExecutionProjection } from '@encois/contracts'
import { Permission, TemporalWorkflowType, WorkflowExecutionStatus } from '@encois/contracts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { WorkflowStatusIndicator } from '@/components/workflow-status'
import { listWorkflowBlueprintsPage, listWorkflows, startWorkflow } from '@/lib/api'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { useCan } from '@/lib/permissions'
import { queryKeys } from '@/lib/query-keys'
import { formatDate } from '@/lib/formatters'
import { ListCollection, ListFilter, ListMeta, ListPagination, ListSearch, ListToolbar, ListViewToggle, type ListViewMode } from '@/components/list-controls'

export const Route = createFileRoute('/_app/workflows/')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.WorkflowsRead)) throw redirect({ to: '/forbidden' })
  },
  component: WorkflowsPage,
})

function WorkflowsPage() {
  const canManage = useCan(Permission.WorkflowsManage)
  const canRun = useCan(Permission.WorkflowsRun)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<WorkflowBlueprintStatus | 'all'>('all')
  const [sort, setSort] = useState<'updated-desc' | 'updated-asc' | 'name-asc' | 'status'>('updated-desc')
  const [view, setView] = useState<ListViewMode>('grid')
  const workflows = useInfiniteQuery({
    queryKey: queryKeys.workflowBlueprints(query, status, sort),
    queryFn: ({ pageParam }) => listWorkflowBlueprintsPage({ query, status, sort, limit: 10, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.pagination.hasMore ? lastPage.pagination.offset + lastPage.pagination.limit : undefined,
    staleTime: 30_000,
  })
  const runs = useQuery({ queryKey: queryKeys.workflows(), queryFn: listWorkflows, staleTime: 5_000 })
  const blueprintItems = workflows.data?.pages.flatMap((page) => page.items) ?? []
  const definitions = useMemo(() => selectWorkflowDefinitions(blueprintItems), [blueprintItems])
  const activeRuns = useMemo(() => selectActiveRuns(runs.data ?? []), [runs.data])

  return <div className="flex flex-col gap-8">
    <PageHeader title="Workflows" description="Browse the workflow definitions available to this organization. Open a definition to inspect its versioned Blueprint or create a new workflow." actions={canManage ? <Button asChild><Link to="/workflows/new"><FilePlus2 data-icon="inline-start" />New workflow</Link></Button> : <span className="text-xs text-muted-foreground">Read-only access</span>} />
    <ListToolbar><ListSearch value={query} onChange={setQuery} placeholder="Search workflows by name or purpose…" label="Search workflows" /><ListFilter value={status} onChange={setStatus} label="Filter workflows by status" options={[{ value: 'all', label: 'All statuses' }, { value: 'draft', label: 'Draft' }, { value: 'approved', label: 'Published' }]} /><ListFilter value={sort} onChange={(value) => setSort(value as typeof sort)} label="Sort workflows" options={[{ value: 'updated-desc', label: 'Recently updated' }, { value: 'updated-asc', label: 'Oldest updated' }, { value: 'name-asc', label: 'Name A–Z' }, { value: 'status', label: 'Status' }]} /><ListViewToggle value={view} onChange={setView} /></ListToolbar>
    <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">{definitions.length} visible workflows</p><ListMeta>API-sorted results</ListMeta></div>
    {workflows.isLoading ? <p className="text-sm text-muted-foreground">Loading workflows…</p> : null}
    {workflows.isError ? <Card><CardContent className="pt-6"><p role="alert" className="text-sm text-destructive">Could not load workflows: {workflows.error.message}</p></CardContent></Card> : null}
    {runs.isError ? <p role="alert" className="text-sm text-muted-foreground">Run actions are unavailable because current runs could not be checked: {runs.error.message}</p> : null}
    {definitions.length ? <ListCollection items={definitions} view={view} getKey={(workflow) => `${workflow.blueprintId}:${workflow.version}`} renderItem={(workflow) => <WorkflowDefinitionCard workflow={workflow} activeRun={activeRuns.get(workflow.blueprintId)} canRun={canRun} runsReady={!runs.isLoading && !runs.isError} />} /> : null}
    {!workflows.isLoading && !workflows.isError && blueprintItems.length > 0 && !definitions.length ? <Card><CardContent className="pt-6"><EmptyPanel icon={Search} title="No workflows match" description="Change the search or status filter." /></CardContent></Card> : null}
    {!workflows.isLoading && !workflows.isError && definitions.length ? <ListPagination hasMore={Boolean(workflows.hasNextPage)} loading={workflows.isFetchingNextPage} onLoadMore={() => void workflows.fetchNextPage()} /> : null}
    {!workflows.isLoading && !workflows.isError && definitions.length === 0 ? <Card><CardContent className="pt-6"><EmptyPanel icon={GitBranch} title="No workflows yet" description={<>Create one from a published <ProductTerm term="template" /> or an approved <ProductTerm term="blueprint" />.</>} action={canManage ? <Button asChild><Link to="/workflows/new"><FilePlus2 data-icon="inline-start" />New workflow</Link></Button> : null} /></CardContent></Card> : null}
  </div>
}

function selectWorkflowDefinitions(blueprints: readonly WorkflowBlueprintProjection[]): readonly WorkflowBlueprintProjection[] {
  const definitions = new Map<string, WorkflowBlueprintProjection>()
  for (const blueprint of blueprints) {
    if (blueprint.status === 'retired') continue
    const current = definitions.get(blueprint.blueprintId)
    if (!current || blueprint.isCurrent || new Date(blueprint.updatedAt).valueOf() > new Date(current.updatedAt).valueOf()) definitions.set(blueprint.blueprintId, blueprint)
  }
  return [...definitions.values()].sort((left, right) => left.name.localeCompare(right.name))
}

const activeRunStatuses: ReadonlySet<WorkflowExecutionStatus> = new Set([
  WorkflowExecutionStatus.Queued,
  WorkflowExecutionStatus.Running,
  WorkflowExecutionStatus.Waiting,
  WorkflowExecutionStatus.Paused,
])

function selectActiveRuns(runs: readonly WorkflowExecutionProjection[]): ReadonlyMap<string, WorkflowExecutionProjection> {
  const activeRuns = new Map<string, WorkflowExecutionProjection>()
  for (const run of runs) {
    if (!run.blueprintId || !activeRunStatuses.has(run.status)) continue
    const current = activeRuns.get(run.blueprintId)
    if (!current || new Date(run.updatedAt).valueOf() > new Date(current.updatedAt).valueOf()) activeRuns.set(run.blueprintId, run)
  }
  return activeRuns
}

function WorkflowDefinitionCard({ workflow, activeRun, canRun, runsReady }: { workflow: WorkflowBlueprintProjection; activeRun?: WorkflowExecutionProjection; canRun: boolean; runsReady: boolean }) {
  const statusLabel = workflow.status === 'approved' ? 'Published' : 'Draft'
  return <Card className="flex h-full flex-col"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{workflow.name}</CardTitle><CardDescription>{statusLabel} · v{workflow.version}{workflow.isCurrent ? ' · current revision' : ''}</CardDescription></div><GitBranch className="size-4 text-muted-foreground" aria-hidden="true" /></div></CardHeader><CardContent className="flex flex-1 flex-col gap-4"><p className="text-sm text-muted-foreground">{workflow.purpose}</p><div className="mt-auto grid gap-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground"><p><span className="font-medium text-foreground">Steps:</span> {workflow.steps.length} · <span className="font-medium text-foreground">Approval:</span> {workflow.requiresApproval ? 'required' : 'not required'}</p><p><span className="font-medium text-foreground">Updated:</span> {formatDate(workflow.updatedAt)}</p></div><WorkflowDefinitionActions workflow={workflow} activeRun={activeRun} canRun={canRun} runsReady={runsReady} /></CardContent></Card>
}

function WorkflowDefinitionActions({ workflow, activeRun, canRun, runsReady }: { workflow: WorkflowBlueprintProjection; activeRun?: WorkflowExecutionProjection; canRun: boolean; runsReady: boolean }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const run = useMutation({
    mutationFn: async () => {
      const latestRuns = await queryClient.fetchQuery({ queryKey: queryKeys.workflows(), queryFn: listWorkflows, staleTime: 0 })
      const latestActiveRun = selectActiveRuns(latestRuns).get(workflow.blueprintId)
      if (latestActiveRun) throw new Error('This workflow already has an active Run.')
      return startWorkflow({ workflowType: TemporalWorkflowType.Dynamic, blueprintId: workflow.blueprintId, blueprintVersion: workflow.version })
    },
    onSuccess: async (started) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workflows() })
      await navigate({ to: '/workflows/$workflowId', params: { workflowId: started.workflowId } })
    },
  })
  const canStartAction = canRun && workflow.status === 'approved' && workflow.isCurrent
  const canStart = canStartAction && runsReady && !activeRun && !run.isPending

  return <div className="flex flex-wrap gap-2">{canStartAction ? activeRun ? <Button variant="outline" asChild><Link to="/workflows/$workflowId" params={{ workflowId: activeRun.workflowId }}><WorkflowStatusIndicator status={activeRun.status} compact />View active run</Link></Button> : <Button onClick={() => run.mutate()} disabled={!canStart} title={!runsReady ? 'Checking current runs…' : undefined}>{run.isPending ? 'Starting…' : <><Play data-icon="inline-start" />Run</>}</Button> : null}<Button variant="outline" asChild><Link to="/workflows/blueprints/$blueprintId" params={{ blueprintId: workflow.blueprintId }}>Open definition</Link></Button>{workflow.status === 'approved' && workflow.isCurrent ? <Button variant="outline" asChild><Link to="/workflows/new" search={{ blueprint: workflow.blueprintId }}>Copy workflow</Link></Button> : null}{run.isError ? <p role="alert" className="basis-full text-xs text-destructive">Could not start this workflow: {run.error.message}</p> : null}</div>
}
