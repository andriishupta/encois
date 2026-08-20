import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Activity, ArrowRight, ArrowUpRight, CheckCircle2, CircleDashed, GitBranch, HeartPulse, PlugZap, Server, Sparkles, Timer, TriangleAlert, X } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { updateMockOnboardingState, type WorkspaceInitializationStatus } from '@/lib/onboarding'
import { useWorkspace, workspaceQueryKey } from '@/lib/workspace'

export const Route = createFileRoute('/_app/')({
  component: DashboardPage,
})

const dashboardWorkflows = [
  { id: 'release-risk-aug-30', title: 'Release risk investigation', status: 'Waiting for input', detail: 'Release context is missing', icon: CircleDashed },
  { id: 'deployment-regression-001', title: 'Deployment regression', status: 'Running', detail: 'Collecting monitoring evidence', icon: Activity },
  { id: 'weekly-delivery-health', title: 'Weekly delivery health', status: 'Completed', detail: 'Last run 2 hours ago', icon: CheckCircle2 },
] as const

const recentActivity = [
  { title: 'GitHub evidence collected', detail: 'Release risk investigation', time: '12 min ago', icon: GitBranch },
  { title: 'Jira context needs input', detail: 'Release risk investigation', time: '28 min ago', icon: CircleDashed },
  { title: 'Delivery health completed', detail: 'Weekly delivery health', time: '2 hours ago', icon: CheckCircle2 },
] as const

const workflowRuns = [
  { title: 'Deployment regression', status: 'Running', time: 'Today, 10:42', icon: Activity },
  { title: 'Weekly delivery health', status: 'Completed', time: 'Today, 08:00', icon: CheckCircle2 },
  { title: 'Release risk investigation', status: 'Waiting', time: 'Yesterday, 16:18', icon: CircleDashed },
] as const

function DashboardPage() {
  const queryClient = useQueryClient()
  const { workspace } = useWorkspace()
  const [startingInitialization, setStartingInitialization] = useState(false)

  function startInitialization() {
    setStartingInitialization(true)
    queryClient.setQueryData(workspaceQueryKey, updateMockOnboardingState({ status: 'initializing' }))
    window.setTimeout(() => {
      setStartingInitialization(false)
      queryClient.setQueryData(workspaceQueryKey, updateMockOnboardingState({ status: 'ready' }))
    }, 1200)
  }

  function dismissReadyBanner() {
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
        <OverviewCard icon={Activity} label="Active workflows" value="2" detail="1 running · 1 waiting" />
        <OverviewCard icon={PlugZap} label="Integrations" value="1" detail="GitHub connected" />
        <OverviewCard icon={GitBranch} label="Recent signals" value="24" detail="Across the last 24 hours" />
        <OverviewCard icon={TriangleAlert} label="Active issues" value="3" detail="2 need attention" />
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
            {dashboardWorkflows.map((workflow) => <DashboardWorkflowRow key={workflow.id} {...workflow} />)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Evidence and system events from your workspace.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {recentActivity.map((item) => <ActivityRow key={item.title} {...item} />)}
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
            <HealthRow icon={Server} label="Gateway API" detail="Waiting for connection" />
            <HealthRow icon={Activity} label="Agent runtime" detail="Waiting for connection" />
            <HealthRow icon={HeartPulse} label="External systems" detail="No integrations connected" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workflow runs</CardTitle>
            <CardDescription>Runs today and over the last seven days.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {workflowRuns.map((run) => <RunRow key={`${run.title}-${run.time}`} {...run} />)}
          </CardContent>
        </Card>
      </div>
    </div>
  )
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

function DashboardWorkflowRow({ id, title, status, detail, icon: Icon }: { id: string; title: string; status: string; detail: string; icon: typeof Activity }) {
  return <Link to="/workflows/$workflowId" params={{ workflowId: id }} className="group flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span><span className="block truncate text-xs text-muted-foreground">{detail}</span></span><span className="hidden rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground sm:block">{status}</span><ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></Link>
}

function ActivityRow({ title, detail, time, icon: Icon }: { title: string; detail: string; time: string; icon: typeof Activity }) {
  return <div className="flex items-center gap-3 rounded-lg border p-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span><span className="block truncate text-xs text-muted-foreground">{detail}</span></span><span className="shrink-0 text-xs text-muted-foreground">{time}</span></div>
}

function RunRow({ title, status, time, icon: Icon }: { title: string; status: string; time: string; icon: typeof Activity }) {
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
