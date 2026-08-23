import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Permission, WorkflowExecutionStatus, type WorkflowRecentActivityProjection } from '@encois/contracts'
import { Activity, ArrowRight, ArrowUpRight, CircleDashed, GitBranch, Play, TriangleAlert } from 'lucide-react'
import { EmptyPanel } from '@/components/empty-panel'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { listWorkflowActivity, listWorkflows } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { usePermissions } from '@/lib/permissions'
import { useOrganization } from '@/lib/organization-context'
import { formatDate, workflowLabel, workflowStatusLabel } from '@/lib/formatters'
import { WorkflowStatusIndicator } from '@/components/workflow-status'

export const Route = createFileRoute('/_app/')({
  component: DashboardPage,
})

function DashboardPage() {
  const { organizationName } = useOrganization()
  const { can } = usePermissions()
  const canViewWorkflows = can(Permission.WorkflowsRead)
  const workflows = useQuery({ queryKey: queryKeys.workflows(), queryFn: listWorkflows, enabled: canViewWorkflows, refetchInterval: (query) => query.state.data?.some((workflow) => isActiveWorkflow(workflow.status)) ? 5_000 : 30_000 })
  const activity = useQuery({ queryKey: queryKeys.workflowActivity(), queryFn: listWorkflowActivity, enabled: canViewWorkflows, refetchInterval: 10_000 })
  const activeRuns = workflows.data?.filter((workflow) => isActiveWorkflow(workflow.status)) ?? []
  const runningRuns = activeRuns.filter((workflow) => workflow.status === WorkflowExecutionStatus.Running).length
  const waitingRuns = activeRuns.filter((workflow) => workflow.status === WorkflowExecutionStatus.Waiting).length
  const attentionRuns = workflows.data?.filter((workflow) => workflow.status === WorkflowExecutionStatus.Failed || workflow.status === WorkflowExecutionStatus.Partial).length ?? 0

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Dashboard"
        description={<>Current activity for <ProductTerm term="scope" /> <span className="font-medium text-foreground">{organizationName ?? 'this organization'}</span>. Counts and events are limited by your permissions; active Runs refresh automatically.</>}
        actions={canViewWorkflows ? <Button asChild><Link to="/workflows"><Play data-icon="inline-start" />Run workflow</Link></Button> : null}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <OverviewCard icon={Activity} label="Active runs" value={metricValue(canViewWorkflows, workflows.isLoading, workflows.isError, activeRuns.length)} detail={!canViewWorkflows ? 'Access restricted' : workflows.isError ? 'Unavailable' : `${runningRuns} running · ${waitingRuns} waiting`} />
        <OverviewCard icon={TriangleAlert} label="Needs attention" value={metricValue(canViewWorkflows, workflows.isLoading, workflows.isError, attentionRuns)} detail={workflows.isError ? 'Unavailable' : 'Failed or partial runs'} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Recent <ProductTerm term="run" plural /></CardTitle>
              <CardDescription>Open a Run to inspect status, evidence, and recovery actions.</CardDescription>
            </div>
            <Link to="/workflows" aria-label="View all workflows" className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><ArrowUpRight className="size-4" aria-hidden="true" /></Link>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {!canViewWorkflows ? <EmptyPanel icon={CircleDashed} title="Workflows are restricted" description="Ask an organization administrator for workflow access." /> : null}
          {canViewWorkflows && workflows.isError ? <p role="alert" className="text-sm text-destructive">Could not load workflows: {workflows.error.message}</p> : null}
          {canViewWorkflows && !workflows.isLoading && !workflows.isError && !workflows.data?.length ? <EmptyPanel icon={CircleDashed} title="No workflow runs yet" description="Open Workflows to start a Run from an approved workflow." /> : null}
          {canViewWorkflows ? workflows.data?.slice(0, 5).map((workflow) => <DashboardWorkflowRow key={workflow.workflowId} id={workflow.workflowId} title={workflowLabel(workflow.blueprintId, workflow.workflowType)} status={workflow.status} detail={workflow.statusMessage ?? (workflow.statusReason ? workflowStatusLabel(workflow.status, workflow.statusReason) : 'No status reason reported')} icon={workflow.status === WorkflowExecutionStatus.Completed ? Activity : GitBranch} />) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription><ProductTerm term="evidence" /> and system events from your workspace.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {!canViewWorkflows ? <EmptyPanel icon={CircleDashed} title="Activity is restricted" description="Ask an organization administrator for workflow access." /> : null}
          {canViewWorkflows && activity.isError ? <p role="alert" className="text-sm text-destructive">Could not load recent activity: {activity.error.message}</p> : null}
          {canViewWorkflows && !activity.isLoading && !activity.isError && activity.data?.length === 0 ? <EmptyPanel icon={CircleDashed} title="No recent activity" description="Workflow events and evidence history will appear here when available." /> : null}
          {canViewWorkflows ? activity.data?.map((event) => <ActivityRow key={event.id} event={event} />) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function ActivityRow({ event }: { event: WorkflowRecentActivityProjection }) {
  const issue = typeof event.metadata.issue === 'string' ? ` · ${event.metadata.issue}` : ''
  return <Link to="/workflows/$workflowId" params={{ workflowId: event.workflowId }} className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Activity className="size-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{event.workflowLabel}</span><span className="block truncate text-xs text-muted-foreground">{event.eventType} · {event.status}{issue}</span></span><span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{formatDate(event.occurredAt)}</span></Link>
}

function isActiveWorkflow(status: WorkflowExecutionStatus): boolean {
  return status === WorkflowExecutionStatus.Queued || status === WorkflowExecutionStatus.Running || status === WorkflowExecutionStatus.Waiting || status === WorkflowExecutionStatus.Paused
}

function DashboardWorkflowRow({ id, title, status, detail, icon: Icon }: { id: string; title: string; status: WorkflowExecutionStatus; detail: string; icon: typeof Activity }) {
  return <Link to="/workflows/$workflowId" params={{ workflowId: id }} className="group flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span><span className="block truncate text-xs text-muted-foreground">{detail}</span></span><span className="hidden sm:block"><WorkflowStatusIndicator status={status} compact /></span><ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></Link>
}

function OverviewCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity
  label: string
  value: string
  detail: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function metricValue(canView: boolean, loading: boolean, error: boolean, value: number): string {
  if (!canView || error) return '—'
  if (loading) return '…'
  return String(value)
}
