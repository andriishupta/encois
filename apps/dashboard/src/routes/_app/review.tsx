import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, ClipboardCheck, Clock3, GitBranch, PlugZap, RefreshCw, Waypoints } from 'lucide-react'
import { IntegrationStatus, KnowledgeSourceStatus, Permission, WorkflowExecutionStatus, type IntegrationProjection, type KnowledgeSource, type WorkflowBlueprintProjection, type WorkflowExecutionProjection, type WorkflowPlanRecord, type WorkflowStep } from '@encois/contracts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { approveWorkflowPlan, applyWorkflowPlan, listIntegrations, listKnowledgeSources, listWorkflowBlueprints, listWorkflowPlans, listWorkflows } from '@/lib/api'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { usePermissions } from '@/lib/permissions'
import { queryKeys } from '@/lib/query-keys'
import { formatDate, workflowLabel, workflowStatusLabel } from '@/lib/formatters'

export const Route = createFileRoute('/_app/review')({
  beforeLoad: () => {
    const session = getAuthSession()
    const canReview = [Permission.WorkflowsRead, Permission.IntegrationsRead, Permission.KnowledgeRead].some((permission) => hasPermission(session, permission))
    if (!canReview) throw redirect({ to: '/forbidden' })
  },
  component: ReviewQueuePage,
})

function ReviewQueuePage() {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const canViewWorkflows = can(Permission.WorkflowsRead)
  const canManageWorkflows = can(Permission.WorkflowsManage)
  const canViewSources = can(Permission.KnowledgeRead)
  const canViewIntegrations = can(Permission.IntegrationsRead)
  const workflows = useQuery({ queryKey: queryKeys.workflows(), queryFn: listWorkflows, enabled: canViewWorkflows })
  const sources = useQuery({ queryKey: queryKeys.sources(), queryFn: listKnowledgeSources, enabled: canViewSources })
  const integrations = useQuery({ queryKey: queryKeys.integrations(), queryFn: listIntegrations, enabled: canViewIntegrations })
  const plans = useQuery({ queryKey: queryKeys.workflowPlans(), queryFn: () => listWorkflowPlans(), enabled: canManageWorkflows })
  const blueprints = useQuery({ queryKey: queryKeys.workflowBlueprints(), queryFn: listWorkflowBlueprints, enabled: canManageWorkflows, staleTime: 30_000 })
  const [planActionError, setPlanActionError] = useState<string | null>(null)
  const approvePlan = useMutation({
    mutationFn: approveWorkflowPlan,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workflowPlans() }),
    onError: (error) => setPlanActionError(error.message),
  })
  const applyPlan = useMutation({
    mutationFn: applyWorkflowPlan,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workflowPlans() }),
    onError: (error) => setPlanActionError(error.message),
  })

  const waitingRuns = workflows.data?.filter((workflow) => workflow.status === WorkflowExecutionStatus.Waiting) ?? []
  const failedRuns = workflows.data?.filter((workflow) => workflow.status === WorkflowExecutionStatus.Failed || workflow.status === WorkflowExecutionStatus.Partial) ?? []
  const unhealthySources = sources.data?.filter((source) => new Set<KnowledgeSourceStatus>([KnowledgeSourceStatus.Degraded, KnowledgeSourceStatus.NeedsReauth, KnowledgeSourceStatus.Failed]).has(source.status)) ?? []
  const pendingIntegrations = integrations.data?.filter((integration) => !new Set<IntegrationStatus>([IntegrationStatus.Active, IntegrationStatus.Disabled]).has(integration.status)) ?? []
  const pendingPlans = plans.data?.filter((plan) => plan.status === 'proposed' || plan.status === 'approved') ?? []
  const attentionCount = waitingRuns.length + failedRuns.length + unhealthySources.length + pendingIntegrations.length + pendingPlans.length
  const reviewQueries = [workflows, sources, integrations, ...(canManageWorkflows ? [plans] : [])]
  const reviewUnavailable = reviewQueries.some((query) => query.isError)
  const reviewLoading = reviewQueries.some((query) => query.isLoading)

  function retryReviewQueue() {
    for (const query of reviewQueries) void query.refetch()
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Review queue"
        description="Operational items that need a human decision or follow-up in the current scope. Each item links to the product surface that owns it."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <QueueSummary icon={Clock3} label="Waiting approvals" value={queueMetric(workflows, waitingRuns.length)} detail="Workflow runs paused for a decision" />
        <QueueSummary icon={AlertTriangle} label="Run attention" value={queueMetric(workflows, failedRuns.length)} detail="Failed or partial investigations" />
        <QueueSummary icon={Waypoints} label="Source attention" value={queueMetric(sources, unhealthySources.length)} detail="Degraded, failed, or reauth required" />
        <QueueSummary icon={PlugZap} label="Integration setup" value={queueMetric(integrations, pendingIntegrations.length)} detail="Pending authorization or error" />
        <QueueSummary icon={ClipboardCheck} label="Workflow plans" value={canManageWorkflows ? queueMetric(plans, pendingPlans.length) : '—'} detail={canManageWorkflows ? 'Proposals awaiting approval or apply' : 'Access restricted'} />
      </div>

      {reviewUnavailable ? <Card className="border-destructive/30 bg-destructive/5"><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 size-5 text-destructive" /><div><p className="font-medium">Review queue unavailable</p><p className="mt-1 text-sm text-muted-foreground">Some operational data could not be loaded, so the queue is not marked clear.</p></div></div><Button type="button" variant="outline" onClick={retryReviewQueue}><RefreshCw data-icon="inline-start" />Retry</Button></CardContent></Card> : null}
      {!reviewUnavailable && !reviewLoading && attentionCount === 0 ? <Card className="border-emerald-500/30 bg-emerald-500/5"><CardContent className="flex items-start gap-3 p-5"><CheckCircle2 className="mt-0.5 size-5 text-emerald-600" /><div><p className="font-medium">Nothing needs attention</p><p className="mt-1 text-sm text-muted-foreground">No waiting approvals, failing runs, unhealthy Sources, or incomplete Integrations are visible in this scope.</p></div></CardContent></Card> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <ReviewCard title="Waiting approvals" description="Runs paused at an explicit human approval boundary." icon={Clock3} loading={workflows.isLoading} error={workflows.error} empty="No workflow run is waiting for approval." hasItems={waitingRuns.length > 0}>
          {waitingRuns.map((workflow) => <WorkflowReviewRow key={workflow.workflowId} workflow={workflow} />)}
        </ReviewCard>
        <ReviewCard title="Run attention" description="Investigations that ended partially or failed." icon={GitBranch} loading={workflows.isLoading} error={workflows.error} empty="No failed or partial workflow runs." hasItems={failedRuns.length > 0}>
          {failedRuns.map((workflow) => <WorkflowReviewRow key={workflow.workflowId} workflow={workflow} />)}
        </ReviewCard>
        <ReviewCard title="Source attention" description="Knowledge Sources that may no longer provide reliable context." icon={Waypoints} loading={sources.isLoading} error={sources.error} empty="All visible Sources are healthy." hasItems={unhealthySources.length > 0}>
          {unhealthySources.map((source) => <SourceReviewRow key={source.id} source={source} />)}
        </ReviewCard>
        <ReviewCard title="Integration setup" description="Connections that still need authorization or recovery." icon={PlugZap} loading={integrations.isLoading} error={integrations.error} empty="All visible Integrations are active or disabled intentionally." hasItems={pendingIntegrations.length > 0}>
          {pendingIntegrations.map((integration) => <IntegrationReviewRow key={integration.id} integration={integration} />)}
        </ReviewCard>
        <ReviewCard title="Workflow plans" description="Persisted proposals are filtered by organization and execution scope before they reach this inbox." icon={ClipboardCheck} loading={plans.isLoading} error={plans.error} empty="No workflow plan is waiting for approval or apply." hasItems={pendingPlans.length > 0}>
          {planActionError ? <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Could not update the workflow plan: {planActionError}</p> : null}
          {pendingPlans.map((plan) => <WorkflowPlanReviewRow key={plan.planId} plan={plan} blueprints={blueprints.data ?? []} busy={approvePlan.isPending || applyPlan.isPending} onApprove={(planId) => { setPlanActionError(null); approvePlan.mutate(planId) }} onApply={(planId) => { setPlanActionError(null); applyPlan.mutate(planId) }} />)}
        </ReviewCard>
      </div>
    </div>
  )
}

function QueueSummary({ icon: Icon, label, value, detail }: { icon: typeof Clock3; label: string; value: number | string; detail: string }) {
  return <Card><CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle><Icon className="size-4 text-muted-foreground" aria-hidden="true" /></CardHeader><CardContent><p className="text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>
}

function queueMetric(query: { isLoading: boolean; isError: boolean }, value: number): number | string {
  if (query.isError) return '—'
  if (query.isLoading) return '…'
  return value
}

function ReviewCard({ title, description, icon: Icon, loading, error, empty, hasItems, children }: { title: string; description: string; icon: typeof Clock3; loading: boolean; error: Error | null; empty: string; hasItems: boolean; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" aria-hidden="true" />{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">{loading ? <p className="text-sm text-muted-foreground">Loading review items…</p> : error ? <p className="text-sm text-destructive">Could not load this queue: {error.message}</p> : hasItems ? children : <EmptyPanel icon={CircleDashed} title="Queue clear" description={empty} />}</CardContent></Card>
}

function WorkflowReviewRow({ workflow }: { workflow: WorkflowExecutionProjection }) {
  return <Link to="/workflows/$workflowId" params={{ workflowId: workflow.workflowId }} className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><GitBranch className="size-4 text-muted-foreground" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{workflowLabel(workflow.blueprintId, workflow.workflowType)}</span><span className="block truncate text-xs text-muted-foreground">{workflow.statusMessage ?? workflowStatusLabel(workflow.status, workflow.statusReason)} · {formatDate(workflow.updatedAt)}</span></span><span className="rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">{workflowStatusLabel(workflow.status)}</span></Link>
}

function SourceReviewRow({ source }: { source: KnowledgeSource }) {
  return <Link to="/sources/$sourceId" params={{ sourceId: source.id }} className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><Waypoints className="size-4 text-muted-foreground" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{source.name}</span><span className="block truncate text-xs text-muted-foreground">{source.provider ?? source.kind} · {source.status.replace('_', ' ')}</span></span><RefreshCw className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></Link>
}

function IntegrationReviewRow({ integration }: { integration: IntegrationProjection }) {
  return <Link to="/integrations/$integrationId" params={{ integrationId: integration.id }} className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><PlugZap className="size-4 text-muted-foreground" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{integration.name}</span><span className="block truncate text-xs text-muted-foreground">{integration.provider} · {integration.status === IntegrationStatus.Error ? 'connection error' : integration.status === IntegrationStatus.NeedsReauth ? 'reauthorization required' : integration.status === IntegrationStatus.Degraded ? 'provider degraded' : integration.status === IntegrationStatus.Authorized ? 'ready to enable' : 'authorization pending'}</span></span><AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden="true" /></Link>
}

function WorkflowPlanReviewRow({ plan, blueprints, busy, onApprove, onApply }: { plan: WorkflowPlanRecord; blueprints: readonly WorkflowBlueprintProjection[]; busy: boolean; onApprove: (planId: string) => void; onApply: (planId: string) => void }) {
  const change = plan.plan.changes[0]
  const label = change?.blueprint?.name ?? change?.reason ?? 'Workflow change proposal'
  const detail = `${change?.kind ?? 'change'} · ${plan.status === 'proposed' ? 'awaiting approval' : 'ready to apply'} · ${formatDate(plan.updatedAt)}`
  return <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><ClipboardCheck className="size-4 text-muted-foreground" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{label}</span><span className="block truncate text-xs text-muted-foreground">{detail}</span><PlanDiff plan={plan} blueprints={blueprints} /><details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">Technical details</summary><code className="mt-1 block break-all">{plan.planId}</code></details></span><span className="flex shrink-0 gap-2">{plan.status === 'proposed' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => onApprove(plan.planId)}>Approve</Button> : <Button size="sm" disabled={busy} onClick={() => onApply(plan.planId)}>Apply</Button>}</span></div>
}

function PlanDiff({ plan, blueprints }: { plan: WorkflowPlanRecord; blueprints: readonly WorkflowBlueprintProjection[] }) {
  const change = plan.plan.changes.find((candidate) => candidate.blueprint)
  const target = change?.blueprint
  if (!target) return <p className="mt-2 text-xs text-muted-foreground">No Blueprint snapshot in this plan; review the target workflow command before applying.</p>
  const baseline = blueprints
    .filter((blueprint) => blueprint.blueprintId === target.blueprintId && blueprint.version !== target.version)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  const beforeById = new Map((baseline?.steps ?? []).map((step) => [step.id, step]))
  const afterById = new Map(target.steps.map((step) => [step.id, step]))
  const changedSteps = [...new Set([...beforeById.keys(), ...afterById.keys()])].flatMap((stepId): Array<{ kind: 'added' | 'removed' | 'changed'; step: WorkflowStep }> => {
    const before = beforeById.get(stepId)
    const after = afterById.get(stepId)
    if (!before && after) return [{ kind: 'added' as const, step: after }]
    if (before && !after) return [{ kind: 'removed' as const, step: before }]
    if (before && after && JSON.stringify(before) !== JSON.stringify(after)) return [{ kind: 'changed' as const, step: after }]
    return []
  })
  return <details className="mt-2 rounded-md border bg-muted/20 px-2.5 py-2 text-xs"><summary className="cursor-pointer font-medium">Review Blueprint diff · v{target.version}</summary><div className="mt-2 flex flex-col gap-2"><div className="flex flex-wrap gap-1.5"><span className="rounded-full bg-secondary px-2 py-1">{baseline ? `Compared with v${baseline.version}` : 'New Blueprint revision'}</span><span className="rounded-full bg-secondary px-2 py-1">{target.steps.length} steps</span>{plan.plan.metadata?.planner ? <span className="rounded-full bg-secondary px-2 py-1">Planner {plan.plan.metadata.planner.name}@{plan.plan.metadata.planner.version}</span> : null}{plan.plan.metadata?.sourceSchemaVersion ? <span className="rounded-full bg-secondary px-2 py-1">Schema {plan.plan.metadata.sourceSchemaVersion}</span> : null}{plan.plan.metadata?.promptHash ? <span className="rounded-full bg-secondary px-2 py-1">Prompt hash recorded</span> : null}</div>{changedSteps.length ? <div className="flex flex-col gap-1">{changedSteps.map((item) => <div key={`${item.kind}:${item.step.id}`} className="flex items-center gap-2"><span className={item.kind === 'added' ? 'text-emerald-700' : item.kind === 'removed' ? 'text-destructive' : 'text-amber-700'}>{item.kind}</span><span className="font-medium">{item.step.id}</span><span className="text-muted-foreground">{stepSummary(item.step)}</span></div>)}</div> : <p className="text-muted-foreground">No step-level changes from the available baseline.</p>}{!baseline ? <p className="text-muted-foreground">No previous approved revision is available for this Blueprint ID, so this plan is treated as a new definition.</p> : null}</div></details>
}

function stepSummary(step: WorkflowStep): string {
  if (step.kind === 'tool') return `tool · ${step.tool ?? 'not specified'}`
  if (step.kind === 'agent') return `agent · ${step.agentDefinition ?? 'not specified'}`
  return step.kind
}
