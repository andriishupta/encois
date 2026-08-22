import { useState, type ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { IntegrationStatus, WorkflowExecutionStatus } from '@encois/contracts'
import { Activity, ArrowRight, ArrowUpRight, CircleDashed, GitBranch, PlugZap, RefreshCw, Sparkles, Timer, TriangleAlert, X } from 'lucide-react'
import { EmptyPanel } from '@/components/empty-panel'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { listIntegrations, listKnowledgeSources, listWorkflowActivity, listWorkflows } from '@/lib/api'
import { isDashboardMockMode } from '@/lib/auth'
import { updateMockOnboardingState, type WorkspaceInitializationStatus } from '@/lib/onboarding'
import { queryKeys } from '@/lib/query-keys'
import { useWorkspace, workspaceQueryKey } from '@/lib/workspace'
import { usePermissions } from '@/lib/permissions'
import { Permission } from '@encois/contracts'
import { formatDate, workflowLabel, workflowStatusLabel } from '@/lib/formatters'

export const Route = createFileRoute('/_app/')({
  component: DashboardPage,
})

function DashboardPage() {
  const queryClient = useQueryClient()
  const { workspace } = useWorkspace()
  const { can } = usePermissions()
  const canViewWorkflows = can(Permission.WorkflowsRead)
  const canViewSources = can(Permission.KnowledgeRead)
  const canViewIntegrations = can(Permission.IntegrationsRead)
  const canManageWorkflows = can(Permission.WorkflowsManage)
  const canManageIntegrations = can(Permission.IntegrationsManage)
  const canManageSources = can(Permission.KnowledgeManage)
  const workflows = useQuery({ queryKey: queryKeys.workflows(), queryFn: listWorkflows, enabled: canViewWorkflows })
  const activity = useQuery({ queryKey: queryKeys.workflowActivity(), queryFn: listWorkflowActivity, enabled: canViewWorkflows })
  const sources = useQuery({ queryKey: queryKeys.sources(), queryFn: listKnowledgeSources, enabled: canViewSources })
  const integrations = useQuery({ queryKey: queryKeys.integrations(), queryFn: listIntegrations, enabled: canViewIntegrations })
  const [startingInitialization, setStartingInitialization] = useState(false)
  const activeWorkflows = workflows.data?.filter((workflow) => isActiveWorkflow(workflow.status)) ?? []
  const runningWorkflows = activeWorkflows.filter((workflow) => workflow.status === WorkflowExecutionStatus.Running).length
  const waitingWorkflows = activeWorkflows.filter((workflow) => workflow.status === WorkflowExecutionStatus.Waiting).length
  const attentionWorkflows = workflows.data?.filter((workflow) => workflow.status === WorkflowExecutionStatus.Failed || workflow.status === WorkflowExecutionStatus.Partial).length ?? 0

  function startInitialization() {
    if (!isDashboardMockMode()) return
    setStartingInitialization(true)
    queryClient.setQueryData(workspaceQueryKey(), updateMockOnboardingState({ status: 'initializing' }))
    window.setTimeout(() => {
      setStartingInitialization(false)
      queryClient.setQueryData(workspaceQueryKey(), updateMockOnboardingState({ status: 'ready' }))
    }, 1200)
  }

  function dismissReadyBanner() {
    if (!isDashboardMockMode()) return
    queryClient.setQueryData(workspaceQueryKey(), updateMockOnboardingState({ initializationBannerDismissed: true }))
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Dashboard"
        description={<>Current activity for <ProductTerm term="scope" /> <span className="font-medium text-foreground">{workspace?.workspaceName ?? 'this organization'}</span>. Counts and events are limited by your permissions.</>}
        actions={<div className="flex flex-wrap items-center gap-2">{canManageIntegrations ? <Button variant="outline" asChild><Link to="/integrations"><PlugZap data-icon="inline-start" />Connect integration</Link></Button> : null}{canManageWorkflows ? <Button asChild><Link to="/workflows/new"><GitBranch data-icon="inline-start" />New workflow</Link></Button> : null}</div>}
      />

      {workspace && !(workspace.status === 'ready' && workspace.initializationBannerDismissed) ? <InitializationCard status={workspace.status} workspaceName={workspace.workspaceName} selectedWorkflows={workspace.selectedWorkflows.length} onStart={startInitialization} onDismiss={dismissReadyBanner} starting={startingInitialization} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewCard icon={Activity} label="Active workflows" value={metricValue(canViewWorkflows, workflows.isLoading, workflows.isError, activeWorkflows.length)} detail={!canViewWorkflows ? 'Access restricted' : workflows.isError ? 'Unavailable' : `${runningWorkflows} running · ${waitingWorkflows} waiting`} />
        <OverviewCard icon={PlugZap} label="Knowledge sources" value={metricValue(canViewSources, sources.isLoading, sources.isError, sources.data?.length ?? 0)} detail={!canViewSources ? 'Access restricted' : sources.isError ? 'Unavailable' : `${sources.data?.filter((source) => source.status === 'active').length ?? 0} active in scope`} />
        <OverviewCard icon={GitBranch} label="Recent activity" value={metricValue(canViewWorkflows, activity.isLoading, activity.isError, activity.data?.length ?? 0)} detail={activity.isError ? 'Unavailable' : 'Events in the current scope'} />
        <OverviewCard icon={TriangleAlert} label="Needs attention" value={metricValue(canViewWorkflows, workflows.isLoading, workflows.isError, attentionWorkflows)} detail={workflows.isError ? 'Unavailable' : 'Failed or partial runs'} />
      </div>

      <ActionCenter
        workflows={workflows.data}
        sources={sources.data}
        integrations={integrations.data}
        canViewWorkflows={canViewWorkflows}
        canViewSources={canViewSources}
        canViewIntegrations={canViewIntegrations}
        canManageWorkflows={canManageWorkflows}
        canManageSources={canManageSources}
        canManageIntegrations={canManageIntegrations}
        loading={workflows.isLoading || sources.isLoading || integrations.isLoading}
        unavailable={workflows.isError || sources.isError || integrations.isError}
      />

      {canViewWorkflows && canViewSources && workflows.isSuccess && sources.isSuccess && (!workflows.data.length || !sources.data.length) ? <SetupNextStepCard hasWorkflows={Boolean(workflows.data.length)} hasSources={Boolean(sources.data.length)} canManageWorkflows={canManageWorkflows} canManageIntegrations={canManageIntegrations} /> : null}

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <CardTitle><ProductTerm term="workflow" plural /></CardTitle>
                <CardDescription>Investigations that need attention.</CardDescription>
              </div>
              <Link to="/workflows" aria-label="View all workflows" className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><ArrowUpRight className="size-4" aria-hidden="true" /></Link>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {!canViewWorkflows ? <EmptyPanel icon={CircleDashed} title="Workflows are restricted" description="Ask an organization administrator for workflow access." /> : null}
            {canViewWorkflows && workflows.isError ? <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-destructive">Could not load workflows: {workflows.error.message}</p><Button type="button" variant="outline" onClick={() => void workflows.refetch()}><RefreshCw data-icon="inline-start" />Retry</Button></div> : null}
            {canViewWorkflows && !workflows.isLoading && !workflows.isError && !workflows.data?.length ? <EmptyPanel icon={CircleDashed} title="No workflow runs yet" description={canManageWorkflows ? <>Create a run from a published <ProductTerm term="template" /> or approved <ProductTerm term="blueprint" />.</> : 'An authorized member can start the first run in this scope.'} /> : null}
            {canViewWorkflows ? workflows.data?.slice(0, 5).map((workflow) => <DashboardWorkflowRow key={workflow.workflowId} id={workflow.workflowId} title={workflowLabel(workflow.blueprintId, workflow.workflowType)} status={workflow.status} detail={workflow.statusMessage ?? (workflow.statusReason ? workflowStatusLabel(workflow.status, workflow.statusReason) : 'No status reason reported')} icon={workflow.status === WorkflowExecutionStatus.Completed ? Activity : GitBranch} />) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription><ProductTerm term="evidence" /> and system events from your workspace.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {activity.isError ? <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-destructive">Could not load recent activity: {activity.error.message}</p><Button type="button" variant="outline" onClick={() => void activity.refetch()}><RefreshCw data-icon="inline-start" />Retry</Button></div> : null}
            {!activity.isLoading && !activity.isError && activity.data?.length === 0 ? <EmptyPanel icon={CircleDashed} title="No recent activity" description="Workflow events and evidence history will appear here when available." /> : null}
            {activity.data?.map((event) => <ActivityRow key={event.id} event={event} />)}
          </CardContent>
        </Card>
      </div>

      <div>
        <Card>
          <CardHeader>
            <CardTitle>Workflow runs</CardTitle>
            <CardDescription>Runs today and over the last seven days.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {canViewWorkflows ? workflows.data?.slice(0, 5).map((workflow) => <RunRow key={workflow.workflowId} title={workflowLabel(workflow.blueprintId, workflow.workflowType)} status={workflow.status} time={formatDate(workflow.updatedAt)} icon={workflow.status === WorkflowExecutionStatus.Completed ? Activity : GitBranch} />) : <p className="text-sm text-muted-foreground">Workflow run history is restricted.</p>}
            {canViewWorkflows && !workflows.isLoading && !workflows.data?.length ? <p className="text-sm text-muted-foreground">No workflow runs yet.</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ActivityRow({ event }: { event: import('@encois/contracts').WorkflowRecentActivityProjection }) {
  const issue = typeof event.metadata.issue === 'string' ? ` · ${event.metadata.issue}` : ''
  return <Link to="/workflows/$workflowId" params={{ workflowId: event.workflowId }} className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Activity className="size-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{event.workflowLabel}</span><span className="block truncate text-xs text-muted-foreground">{event.eventType} · {event.status}{issue}</span></span><span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{formatDate(event.occurredAt)}</span></Link>
}

function isActiveWorkflow(status: WorkflowExecutionStatus): boolean {
  return status === WorkflowExecutionStatus.Queued || status === WorkflowExecutionStatus.Running || status === WorkflowExecutionStatus.Waiting || status === WorkflowExecutionStatus.Paused || status === WorkflowExecutionStatus.Partial
}

function SetupNextStepCard({ hasWorkflows, hasSources, canManageWorkflows, canManageIntegrations }: { hasWorkflows: boolean; hasSources: boolean; canManageWorkflows: boolean; canManageIntegrations: boolean }) {
  return (
    <Card className="border-primary/25 bg-primary/[0.025]">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <p className="font-semibold">Complete the workspace foundation</p>
          <p className="mt-1 text-sm text-muted-foreground">Workflows need a connected source and a clear scope before investigations can produce useful evidence.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground"><span className="rounded-full bg-secondary px-2 py-1">{hasSources ? 'Source connected' : 'Source missing'}</span><span className="rounded-full bg-secondary px-2 py-1">{hasWorkflows ? 'Run created' : 'No runs yet'}</span></div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">{!hasSources && canManageIntegrations ? <Button variant="outline" asChild><Link to="/integrations">Connect source</Link></Button> : null}{!hasWorkflows && canManageWorkflows ? <Button asChild><Link to="/workflows/new">Create workflow</Link></Button> : null}</div>
      </CardContent>
    </Card>
  )
}

type Action = {
  key: string
  title: string
  description: string
  to: '/integrations' | '/sources/new' | '/workflows' | '/workflows/new' | '/context'
  label: string
  tone?: 'attention' | 'default'
}

function ActionCenter({
  workflows,
  sources,
  integrations,
  canViewWorkflows,
  canViewSources,
  canViewIntegrations,
  canManageWorkflows,
  canManageSources,
  canManageIntegrations,
  loading,
  unavailable,
}: {
  workflows?: readonly import('@encois/contracts').WorkflowExecutionProjection[]
  sources?: readonly import('@encois/contracts').KnowledgeSource[]
  integrations?: readonly import('@encois/contracts').IntegrationProjection[]
  canViewWorkflows: boolean
  canViewSources: boolean
  canViewIntegrations: boolean
  canManageWorkflows: boolean
  canManageSources: boolean
  canManageIntegrations: boolean
  loading: boolean
  unavailable: boolean
}) {
  const actions: Action[] = []
  const activeIntegrations = integrations?.filter((item) => item.status === IntegrationStatus.Active) ?? []
  const needsRunReview = workflows?.some((item) => item.status === WorkflowExecutionStatus.Waiting || item.status === WorkflowExecutionStatus.Failed || item.status === WorkflowExecutionStatus.Partial)

  if (canViewIntegrations && canManageIntegrations && integrations && activeIntegrations.length === 0) {
    actions.push({ key: 'integration', title: 'Connect a provider', description: 'Authorize a read-only provider before creating a workflow that needs external evidence.', to: '/integrations', label: 'Open integrations' })
  }
  if (canViewSources && canManageSources && sources && sources.length === 0) {
    actions.push({ key: 'source', title: 'Add a Knowledge Source', description: 'Upload context or bind an authorized integration to make evidence available to runs.', to: '/sources/new', label: 'Add Source' })
  }
  if (canViewWorkflows && canManageWorkflows && workflows && workflows.length === 0) {
    actions.push({ key: 'workflow', title: 'Create the first workflow', description: 'Choose a published Template, an approved Blueprint, or describe a GitHub/Jira investigation.', to: '/workflows/new', label: 'Create workflow' })
  }
  if (canViewWorkflows && needsRunReview) {
    actions.push({ key: 'review', title: 'Review workflow attention', description: 'Waiting, failed, or partial Runs need an explicit human decision before they can progress.', to: '/workflows', label: 'Review Runs', tone: 'attention' })
  }
  if (canViewSources && canViewWorkflows && sources && workflows && sources.length > 0 && workflows.length > 0) {
    actions.push({ key: 'context', title: 'Check project context', description: 'Inspect the scoped graph and freshness before trusting a new investigation.', to: '/context', label: 'Open context' })
  }

  return <Card className="border-primary/20 bg-primary/[0.02]"><CardHeader><CardTitle>Next actions</CardTitle><CardDescription>{unavailable ? 'Some recommendations are unavailable because a scoped data source failed to load.' : loading ? 'Checking the current workspace state…' : actions.length ? 'Recommended actions based on the data and permissions visible in this scope.' : 'No immediate setup action is required in the current scope.'}</CardDescription></CardHeader><CardContent>{unavailable ? <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">Retry the affected panel below to refresh recommendations.</p><Link to="/review" className="text-sm font-medium underline underline-offset-4">Open review</Link></div> : loading ? <p className="text-sm text-muted-foreground">Loading recommendations…</p> : actions.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{actions.slice(0, 6).map((action) => <div key={action.key} className={`flex flex-col gap-3 rounded-lg border p-4 ${action.tone === 'attention' ? 'border-amber-500/30 bg-amber-500/[0.04]' : 'bg-background'}`}><div className="flex-1"><p className="text-sm font-medium">{action.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{action.description}</p></div><Button variant={action.tone === 'attention' ? 'default' : 'outline'} size="sm" className="self-start" asChild><Link to={action.to}>{action.label}<ArrowRight data-icon="inline-end" /></Link></Button></div>)}</div> : <div className="flex items-center gap-3 text-sm text-muted-foreground"><span className="size-2 rounded-full bg-emerald-500" />Workspace foundations and active review queues are in place.</div>}</CardContent></Card>
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
            <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{isReady ? 'Workspace is ready' : isInitializing ? <><ProductTerm term="coordinator" /> is initializing</> : 'Workspace pending initialization'}</h2><span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">{selectedWorkflows} <ProductTerm term="workflow" plural /> selected</span></div>
            <p className="mt-1 text-sm text-muted-foreground">{workspaceName ? `${workspaceName} has the context needed to begin.` : <>Your <ProductTerm term="coordinator" /> is ready to prepare the first workspace context.</>}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          {!isReady ? <Button type="button" onClick={onStart} disabled={starting}>{isInitializing ? <>Starting <ProductTerm term="coordinator" />…</> : 'Initialize workspace'}<ArrowRight data-icon="inline-end" /></Button> : <span className="text-sm font-medium text-primary"><ProductTerm term="coordinator" /> ready</span>}
          {!isReady ? <Link to="/onboarding/workflows" className="text-center text-xs text-muted-foreground underline underline-offset-4 sm:text-right">Review workflow selection</Link> : null}
        </div>
        {isReady ? <Button type="button" variant="ghost" size="icon" aria-label="Dismiss workspace ready message" onClick={onDismiss}><X /></Button> : null}
      </CardContent>
    </Card>
  )
}

function DashboardWorkflowRow({ id, title, status, detail, icon: Icon }: { id: string; title: string; status: WorkflowExecutionStatus; detail: string; icon: typeof Activity }) {
  return <Link to="/workflows/$workflowId" params={{ workflowId: id }} className="group flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span><span className="block truncate text-xs text-muted-foreground">{detail}</span></span><span className="hidden rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground sm:block">{workflowStatusLabel(status)}</span><ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></Link>
}

function RunRow({ title, status, time, icon: Icon }: { title: string; status: WorkflowExecutionStatus; time: string; icon: typeof Activity }) {
  return <div className="flex items-center gap-3 rounded-lg border p-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span><span className="block text-xs text-muted-foreground">{time}</span></span><span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"><Timer className="size-3.5" aria-hidden="true" />{workflowStatusLabel(status)}</span></div>
}

function OverviewCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity
  label: ReactNode
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
