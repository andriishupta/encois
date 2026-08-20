import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Activity, ArrowRight, ArrowUpRight, CircleDashed, GitBranch, HeartPulse, PlugZap, Server, Sparkles, TriangleAlert } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { EmptyPanel } from '@/components/empty-panel'
import { updateMockOnboardingState, type WorkspaceInitializationStatus } from '@/lib/onboarding'
import { useWorkspace, workspaceQueryKey } from '@/lib/workspace'

export const Route = createFileRoute('/_app/')({
  component: DashboardPage,
})

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

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Dashboard"
        description="A clear view of your organization’s current context and active work."
      />

      {workspace ? <InitializationCard status={workspace.status} workspaceName={workspace.workspaceName} selectedWorkflows={workspace.selectedWorkflows.length} onStart={startInitialization} starting={startingInitialization} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewCard icon={Activity} label="Active workflows" value="—" detail="No workflows running" />
        <OverviewCard icon={PlugZap} label="Integrations" value="—" detail="No integrations connected" />
        <OverviewCard icon={GitBranch} label="Recent signals" value="—" detail="No signals collected yet" />
        <OverviewCard icon={TriangleAlert} label="Active issues" value="—" detail="No issue data available" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <CardTitle>Current workflows</CardTitle>
                <CardDescription>Investigations that need attention.</CardDescription>
              </div>
              <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </div>
          </CardHeader>
          <CardContent>
            <EmptyPanel icon={CircleDashed} title="No active workflows" description="Running investigations will appear here." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Evidence and system events from your workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyPanel icon={Activity} title="No recent activity" description="Activity will appear as your workspace starts receiving signals." />
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
          <CardContent>
            <EmptyPanel icon={Activity} title="No run data yet" description="A run history chart will appear when workflow projections are available." />
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
  starting,
}: {
  status: WorkspaceInitializationStatus
  workspaceName?: string
  selectedWorkflows: number
  onStart: () => void
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
      </CardContent>
    </Card>
  )
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
