import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { WorkflowExecutionStatus, type WorkflowExecutionProjection } from '@encois/contracts'
import { Activity, ArrowUpRight, CircleDashed, Clock3, GitBranch, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { EmptyPanel } from '@/components/empty-panel'
import { ProductTerm } from '@/components/product-term'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { listWorkflows } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { formatDate, shortIdentifier, workflowLabel, workflowStatusLabel } from '@/lib/formatters'
import { WorkflowStatusIndicator } from '@/components/workflow-status'

export function WorkflowRunList() {
  const workflows = useQuery({ queryKey: queryKeys.workflows(), queryFn: listWorkflows })
  const hasRuns = Boolean(workflows.data?.length)
  const [status, setStatus] = useState<WorkflowExecutionStatus | 'all'>('all')
  const filteredWorkflows = (workflows.data ?? []).filter((workflow) => status === 'all' || workflow.status === status)

  return <div className="flex flex-col gap-8">
    <PageHeader title={<ProductTerm term="run" plural />} description="Monitor each workflow execution, its current state, and the evidence it produces." />
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">Run history</p><p className="mt-1 text-xs text-muted-foreground">Filter workflow executions by lifecycle state. Technical IDs stay secondary to the business status.</p></div><div className="flex items-center gap-3"><select value={status} onChange={(event) => setStatus(event.target.value as WorkflowExecutionStatus | 'all')} aria-label="Filter workflow runs by status" className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><option value="all">All statuses</option>{Object.values(WorkflowExecutionStatus).map((value) => <option key={value} value={value}>{workflowStatusLabel(value)}</option>)}</select><span className="text-xs text-muted-foreground">{filteredWorkflows.length} visible</span></div></CardContent>
    </Card>
    {workflows.isLoading ? <p className="text-sm text-muted-foreground">Loading workflow runs…</p> : null}
    {workflows.isError ? <Card><CardContent className="pt-6"><p role="alert" className="text-sm text-destructive">Could not load workflow runs: {workflows.error.message}</p></CardContent></Card> : null}
    {filteredWorkflows.length ? <div className="grid gap-4">{filteredWorkflows.map((workflow) => <WorkflowRunCard key={workflow.workflowId} workflow={workflow} />)}</div> : null}
    {!workflows.isLoading && !workflows.isError && hasRuns && !filteredWorkflows.length ? <Card><CardContent className="pt-6"><EmptyPanel icon={RefreshCw} title="No runs match" description="Choose another lifecycle status." /></CardContent></Card> : null}
    {!workflows.isLoading && !workflows.isError && !hasRuns ? <Card><CardContent className="pt-6"><EmptyPanel icon={CircleDashed} title="No workflow runs yet" description="A workflow run will appear here when an authorized member starts one." /></CardContent></Card> : null}
  </div>
}

function WorkflowRunCard({ workflow }: { workflow: WorkflowExecutionProjection }) {
  const label = workflowLabel(workflow.blueprintId, workflow.workflowType)
  const Icon = workflow.status === WorkflowExecutionStatus.Completed ? Activity : GitBranch

  return <Link to="/workflows/$workflowId" params={{ workflowId: workflow.workflowId }} className="group"><Card className="transition-colors group-hover:border-foreground/30"><CardHeader className="flex flex-row items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/30"><Icon className="size-4 text-muted-foreground" aria-hidden="true" /></span><div className="flex min-w-0 flex-col gap-1.5"><CardTitle className="truncate">{label}</CardTitle><CardDescription className="truncate">{workflow.statusMessage ?? 'Current workflow run status and progress.'}</CardDescription></div></div><ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" /></CardHeader><CardContent className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground"><WorkflowStatusIndicator status={workflow.status} reason={workflow.statusReason} compact /><span className="flex items-center gap-1.5"><Clock3 className="size-3.5" aria-hidden="true" />Updated {formatDate(workflow.updatedAt)}</span><span className="truncate text-muted-foreground">Trigger: {workflow.trigger ?? 'Not reported'}</span><span className="truncate text-muted-foreground">Technical ID: <span className="font-mono">{shortIdentifier(workflow.workflowId)}</span></span></CardContent></Card></Link>
}
