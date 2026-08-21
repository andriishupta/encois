import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { IntegrationStatus, WorkflowExecutionStatus } from '@encois/contracts'
import { Activity, ArrowRight, ArrowUpRight, CircleDashed, GitBranch, HeartPulse, PlugZap, Server, Sparkles, Timer, TriangleAlert, X } from 'lucide-react'
import { EmptyPanel } from '@/components/empty-panel'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { listIntegrations, listKnowledgeSources, listWorkflows } from '@/lib/api'
import { isDashboardMockMode } from '@/lib/auth'
import { updateMockOnboardingState, type WorkspaceInitializationStatus } from '@/lib/onboarding'
import { queryKeys } from '@/lib/query-keys'
import { useWorkspace, workspaceQueryKey } from '@/lib/workspace'

export const Route = createFileRoute('/_app/')({
  component: DashboardPage,
})

function DashboardPage() {
  const queryClient = useQueryClient()
  const { workspace } = useWorkspace()
  const workflows = useQuery({ queryKey: queryKeys.workflows(), queryFn: listWorkflows })
  const integrations = useQuery({ queryKey: queryKeys.integrations(), queryFn: listIntegrations })
  const sources = useQuery({ queryKey: queryKeys.sources(), queryFn: listKnowledgeSources })
  const [startingInitialization, setStartingInitialization] = useState(false)
  const activeWorkflows = workflows.data?.filter((workflow) => isActiveWorkflow(workflow.status)) ?? []
  const runningWorkflows = activeWorkflows.filter((workflow) => workflow.status === WorkflowExecutionStatus.Running).length
  const waitingWorkflows = activeWorkflows.filter((workflow) => workflow.status === WorkflowExecutionStatus.Waiting).length
  const connectedIntegrations = integrations.data?.filter((integration) => integration.status === IntegrationStatus.Active).length ?? 0
  const attentionWorkflows = workflows.data?.filter((workflow) => workflow.status === WorkflowExecutionStatus.Failed || workflow.status === WorkflowExecutionStatus.Partial).length ?? 0

  function startInitialization() {
    if (!isDashboardMockMode()) return
    setStartingInitialization(true)
    queryClient.setQueryData(workspaceQueryKey, updateMockOnboardingState({ status: 'initializing' }))
    window.setTimeout(() => {
      setStartingInitialization(false)
      queryClient.setQueryData(workspaceQueryKey, updateMockOnboardingState({ status: 'ready' }))
    }, 1200)
  }

  function dismissReadyBanner() {
    if (!isDashboardMockMode()) return
    queryClient.setQueryData(workspaceQueryKey, updateMockOnboardingState({ initializationBannerDismissed: true }))
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Dashboard"
        description="A clear view of your organization’s current context and active work."
      />

      {workspace && !(workspace.status === 'ready' && workspace.initializationBannerDismissed) ? <InitializationCard status={workspace.status} workspaceName={workspace.workspaceName} selectedWorkflows={workspace.selectedWorkflows.length} onStart={startInitialization} onDismiss={dismissReadyBanner} starting={startingInitialization} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewCard icon={Activity} label="Active workflows" value={workflows.isLoading ? '…' : String(activeWorkflows.length)} detail={`${runningWorkflows} running · ${waitingWorkflows} waiting`} />
        <OverviewCard icon={PlugZap} label="Knowledge sources" value={sources.isLoading ? '…' : String(sources.data?.length ?? 0)} detail={`${sources.data?.filter((source) => source.status === 'active').length ?? 0} active in scope`} />
        <OverviewCard icon={GitBranch} label="Recent signals" value="—" detail="Events endpoint is not exposed yet" />
        <OverviewCard icon={TriangleAlert} label="Needs attention" value={workflows.isLoading ? '…' : String(attentionWorkflows)} detail="Failed or partial workflows" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <CardTitle>Workflows</CardTitle>
                <CardDescription>Investigations that need attention.</CardDescription>
              </div>
              <Link to="/workflows" aria-label="View all workflows" className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><ArrowUpRight className="size-4" aria-hidden="true" /></Link>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {workflows.isError ? <p className="text-sm text-destructive">Could not load workflows: {workflows.error.message}</p> : null}
            {!workflows.isLoading && !workflows.isError && !workflows.data?.length ? <EmptyPanel icon={CircleDashed} title="No workflows yet" description="Start a Blueprint execution to create the first durable workflow." /> : null}
            {workflows.data?.slice(0, 5).map((workflow) => <DashboardWorkflowRow key={workflow.workflowId} id={workflow.workflowId} title={workflow.blueprintId ?? workflow.workflowType} status={workflow.status} detail={workflow.statusReason ?? 'No status reason reported'} icon={workflow.status === WorkflowExecutionStatus.Completed ? Activity : GitBranch} />)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Evidence and system events from your workspace.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <EmptyPanel icon={CircleDashed} title="Activity projection is not available" description="Workflow events and evidence history are not exposed by the current Gateway API." />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Workspace health</CardTitle>
            <CardDescription>Current status of the Encois runtime surface.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <HealthRow icon={Server} label="Gateway API" detail={workflows.isError || integrations.isError || sources.isError ? 'Request failed' : workflows.isLoading || integrations.isLoading || sources.isLoading ? 'Checking…' : 'Connected'} />
            <HealthRow icon={Activity} label="Agent runtime" detail="Health endpoint is not exposed to the Dashboard" />
            <HealthRow icon={HeartPulse} label="External systems" detail={connectedIntegrations ? `${connectedIntegrations} active integration${connectedIntegrations === 1 ? '' : 's'}` : 'No active integrations'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workflow runs</CardTitle>
            <CardDescription>Runs today and over the last seven days.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {workflows.data?.slice(0, 5).map((workflow) => <RunRow key={workflow.workflowId} title={workflow.blueprintId ?? workflow.workflowType} status={workflow.status} time={formatDate(workflow.updatedAt)} icon={workflow.status === WorkflowExecutionStatus.Completed ? Activity : GitBranch} />)}
            {!workflows.isLoading && !workflows.data?.length ? <p className="text-sm text-muted-foreground">No workflow runs returned by the Gateway.</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function isActiveWorkflow(status: WorkflowExecutionStatus): boolean {
  return status === WorkflowExecutionStatus.Queued || status === WorkflowExecutionStatus.Running || status === WorkflowExecutionStatus.Waiting || status === WorkflowExecutionStatus.Partial
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Time unavailable' : date.toLocaleString()
}

function InitializationCard({
  status,
  workspaceName,
  selectedWorkflows,
  onStart,
  onDismiss,
  starting,
}: {
  status: WorkspaceInitializationStatus
  workspaceName?: string
  selectedWorkflows: number
  onStart: () => void
  onDismiss: () => void
  starting: boolean
}) {
  const isReady = status === 'ready'
  const isInitializing = status === 'initializing'

  return (
    <Card className={isReady ? 'border-primary/30' : 'border-primary/30 bg-primary/[0.025]'}>
      <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Sparkles className="size-5" aria-hidden="true" /></span>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{isReady ? 'Workspace is ready' : isInitializing ? 'Coordinator is initializing' : 'Workspace pending initialization'}</h2><span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">{selectedWorkflows} workflows selected</span></div>
            <p className="mt-1 text-sm text-muted-foreground">{workspaceName ? `${workspaceName} has the context needed to begin.` : 'Your Coordinator is ready to prepare the first workspace context.'}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          {!isReady ? <Button type="button" onClick={onStart} disabled={starting}>{isInitializing ? 'Starting Coordinator…' : 'Initialize workspace'}<ArrowRight data-icon="inline-end" /></Button> : <span className="text-sm font-medium text-primary">Coordinator ready</span>}
          {!isReady ? <Link to="/onboarding/workflows" className="text-center text-xs text-muted-foreground underline underline-offset-4 sm:text-right">Review workflow selection</Link> : null}
        </div>
        {isReady ? <Button type="button" variant="ghost" size="icon" aria-label="Dismiss workspace ready message" onClick={onDismiss}><X /></Button> : null}
      </CardContent>
    </Card>
  )
}

function DashboardWorkflowRow({ id, title, status, detail, icon: Icon }: { id: string; title: string; status: WorkflowExecutionStatus; detail: string; icon: typeof Activity }) {
  return <Link to="/workflows/$workflowId" params={{ workflowId: id }} className="group flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span><span className="block truncate text-xs text-muted-foreground">{detail}</span></span><span className="hidden rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground sm:block">{status}</span><ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></Link>
}

function RunRow({ title, status, time, icon: Icon }: { title: string; status: WorkflowExecutionStatus; time: string; icon: typeof Activity }) {
  return <div className="flex items-center gap-3 rounded-lg border p-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span><span className="block text-xs text-muted-foreground">{time}</span></span><span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"><Timer className="size-3.5" aria-hidden="true" />{status}</span></div>
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

function HealthRow({
  icon: Icon,
  label,
  detail,
}: {
  icon: typeof Activity
  label: string
  detail: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-3">
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <span className="rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">Not connected</span>
    </div>
  )
}
