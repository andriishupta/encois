import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CircleDashed, GitBranch, RefreshCw, RotateCcw, TimerReset } from 'lucide-react'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { WorkflowCanvas } from '@/components/workflow-canvas'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getWorkflow, getWorkflowEvents } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { Permission } from '@encois/contracts'

export const Route = createFileRoute('/_app/workflows/$workflowId')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.WorkflowsRead)) throw redirect({ to: '/forbidden' })
  },
  component: WorkflowDetailPage,
})

function WorkflowDetailPage() {
  const { workflowId } = Route.useParams()
  const workflow = useQuery({ queryKey: queryKeys.workflow(workflowId), queryFn: () => getWorkflow(workflowId), refetchInterval: 30_000 })
  const events = useQuery({ queryKey: queryKeys.workflowEvents(workflowId), queryFn: () => getWorkflowEvents(workflowId), enabled: workflow.isSuccess, refetchInterval: 30_000 })
  const status = workflow.data?.status ?? (workflow.isLoading ? 'loading' : 'unavailable')
  const eventRows = events.data ?? []
  const activityRows = eventRows.filter((event) => event.activityName && event.eventType.startsWith('activity_'))
  const transitionCount = eventRows.filter((event) => event.eventType === 'workflow_status_updated').length

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={<><ProductTerm term="blueprint" /> execution</>} description={<><ProductTerm term="workflow" /> execution detail and the <ProductTerm term="evidence" /> collection lifecycle.</>} actions={<Button disabled>Run workflow</Button>} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Status" value={status} icon={CircleDashed} />
        <SummaryCard label="Workflow ID" value={workflowId} icon={GitBranch} mono />
        <SummaryCard label="Run ID" value={workflow.data?.runId ?? 'Not available'} icon={RotateCcw} />
        <SummaryCard label="Transitions" value={events.isLoading ? '…' : String(transitionCount)} icon={TimerReset} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle><ProductTerm term="workflow" /> canvas</CardTitle>
            <CardDescription>Topology preview for the selected <ProductTerm term="workflow" />. Step-level details will appear as they become available.</CardDescription>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="size-3.5" aria-hidden="true" />
            <span>Auto-refresh every 30s</span>
          </div>
        </CardHeader>
        <CardContent>
          <WorkflowCanvas refreshCount={workflow.dataUpdatedAt} lastPolledAt={workflow.dataUpdatedAt ? new Date(workflow.dataUpdatedAt) : null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Execution steps</CardTitle>
          <CardDescription>Step activity and specialist work for this <ProductTerm term="workflow" />.</CardDescription>
        </CardHeader>
        <CardContent>
          {events.isError ? <p className="text-sm text-destructive">Could not load step activity: {events.error.message}</p> : null}
          {!events.isLoading && !events.isError && activityRows.length === 0 ? <EmptyPanel icon={CircleDashed} title="No step activity yet" description="Detailed step activity will appear here when available." /> : null}
          <div className="flex flex-col gap-2">
            {activityRows.map((event) => <ActivityRow key={event.id} event={event} />)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle><ProductTerm term="evidence" /> and event history</CardTitle>
          <CardDescription>Source references, timestamps, retries, and state transitions will appear here.</CardDescription>
        </CardHeader>
        <CardContent>
          {!events.isLoading && !events.isError && eventRows.length === 0 ? <EmptyPanel icon={CircleDashed} title="No event history yet" description={<><ProductTerm term="evidence" /> references, retries, and state transitions will appear here when available.</>} /> : null}
          <div className="flex flex-col gap-2">
            {eventRows.map((event) => <EventRow key={event.id} event={event} />)}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ActivityRow({ event }: { event: import('@encois/contracts').WorkflowEventProjection }) {
  const issue = typeof event.metadata.issue === 'string' ? event.metadata.issue : undefined
  const attempt = typeof event.metadata.attempt === 'number' ? `attempt ${event.metadata.attempt}` : undefined
  const shard = typeof event.metadata.shard === 'string' ? `shard ${event.metadata.shard}` : undefined
  const duration = typeof event.metadata.durationMs === 'number' ? `${event.metadata.durationMs}ms` : undefined
  return <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:gap-4"><span className="min-w-0 flex-1 font-medium">{event.activityName}</span><span className="text-xs text-muted-foreground">{event.status}{attempt ? ` · ${attempt}` : ''}{shard ? ` · ${shard}` : ''}{duration ? ` · ${duration}` : ''}{issue ? ` · ${issue}` : ''}</span><span className="text-xs text-muted-foreground">{formatDate(event.occurredAt)}</span></div>
}

function EventRow({ event }: { event: import('@encois/contracts').WorkflowEventProjection }) {
  const shard = typeof event.metadata.shard === 'string' ? event.metadata.shard : undefined
  return <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{event.eventType}</span><span className="text-xs text-muted-foreground">{formatDate(event.occurredAt)}</span></div><div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{event.status}</span>{shard ? <span>shard: {shard}</span> : null}{event.evidenceRef ? <span className="font-mono">{event.evidenceRef}</span> : null}{event.agentRunId ? <span className="font-mono">{event.agentRunId}</span> : null}</div></div>
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Time unavailable' : date.toLocaleString()
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  mono = false,
}: {
  label: string
  value: string
  icon: typeof GitBranch
  mono?: boolean
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <p className={mono ? 'truncate font-mono text-sm' : 'truncate text-sm font-medium'}>{value}</p>
      </CardContent>
    </Card>
  )
}
