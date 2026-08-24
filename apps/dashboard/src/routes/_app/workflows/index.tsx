import { useMemo, useState } from 'react'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FilePlus2, GitBranch, Play, Search } from 'lucide-react'
import type { WorkflowBlueprintProjection, WorkflowBlueprintStatus, WorkflowExecutionProjection } from '@encois/contracts'
import { Permission, TemporalWorkflowType, WorkflowExecutionStatus } from '@encois/contracts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { WorkflowStatusIndicator } from '@/components/workflow-status'
import { listWorkflowBlueprints, listWorkflows, startWorkflow } from '@/lib/api'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { useCan } from '@/lib/permissions'
import { queryKeys } from '@/lib/query-keys'
import { formatDate } from '@/lib/formatters'

export const Route = createFileRoute('/_app/workflows/')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.WorkflowsRead)) throw redirect({ to: '/forbidden' })
  },
  component: WorkflowsPage,
})

function WorkflowsPage() {
  const canManage = useCan(Permission.WorkflowsManage)
  const canRun = useCan(Permission.WorkflowsRun)
  const workflows = useQuery({ queryKey: queryKeys.workflowBlueprints(), queryFn: listWorkflowBlueprints, staleTime: 30_000 })
  const runs = useQuery({ queryKey: queryKeys.workflows(), queryFn: listWorkflows, staleTime: 5_000 })
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<WorkflowBlueprintStatus | 'all'>('all')
  const definitions = useMemo(() => selectWorkflowDefinitions(workflows.data ?? []), [workflows.data])
  const activeRuns = useMemo(() => selectActiveRuns(runs.data ?? []), [runs.data])
  const filteredDefinitions = definitions.filter((workflow) => {
    const normalizedQuery = query.trim().toLowerCase()
    return (status === 'all' || workflow.status === status) && (!normalizedQuery || [workflow.name, workflow.purpose, workflow.blueprintId].some((value) => value.toLowerCase().includes(normalizedQuery)))
  })

  return <div className="flex flex-col gap-8">
    <PageHeader title="Workflows" description="Browse the workflow definitions available to this organization. Open a definition to inspect its versioned Blueprint or create a new workflow." actions={canManage ? <Button asChild><Link to="/workflows/new"><FilePlus2 data-icon="inline-start" />New workflow</Link></Button> : <span className="text-xs text-muted-foreground">Read-only access</span>} />
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workflows by name or purpose…" aria-label="Search workflows" className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50" /></div><select value={status} onChange={(event) => setStatus(event.target.value as WorkflowBlueprintStatus | 'all')} aria-label="Filter workflows by status" className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><option value="all">All statuses</option><option value="draft">Draft</option><option value="approved">Published</option><option value="retired">Archived</option></select><span className="text-xs text-muted-foreground">{filteredDefinitions.length} visible workflows</span></CardContent>
    </Card>
    {workflows.isLoading ? <p className="text-sm text-muted-foreground">Loading workflows…</p> : null}
    {workflows.isError ? <Card><CardContent className="pt-6"><p role="alert" className="text-sm text-destructive">Could not load workflows: {workflows.error.message}</p></CardContent></Card> : null}
    {runs.isError ? <p role="alert" className="text-sm text-muted-foreground">Run actions are unavailable because current runs could not be checked: {runs.error.message}</p> : null}
    {filteredDefinitions.length ? <div className="grid gap-4 md:grid-cols-2">{filteredDefinitions.map((workflow) => <WorkflowDefinitionCard key={`${workflow.blueprintId}:${workflow.version}`} workflow={workflow} activeRun={activeRuns.get(workflow.blueprintId)} canRun={canRun} runsReady={!runs.isLoading && !runs.isError} />)}</div> : null}
    {!workflows.isLoading && !workflows.isError && definitions.length > 0 && !filteredDefinitions.length ? <Card><CardContent className="pt-6"><EmptyPanel icon={Search} title="No workflows match" description="Change the search or status filter." /></CardContent></Card> : null}
    {!workflows.isLoading && !workflows.isError && definitions.length === 0 ? <Card><CardContent className="pt-6"><EmptyPanel icon={GitBranch} title="No workflows yet" description={<>Create one from a published <ProductTerm term="template" /> or an approved <ProductTerm term="blueprint" />.</>} action={canManage ? <Button asChild><Link to="/workflows/new"><FilePlus2 data-icon="inline-start" />Create workflow</Link></Button> : null} /></CardContent></Card> : null}
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
