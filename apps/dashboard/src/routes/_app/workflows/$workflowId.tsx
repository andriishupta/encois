import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ContractVersion, isJsonObject, Permission, WorkflowExecutionStatus, WorkflowSignalName, type WorkflowEventProjection } from '@encois/contracts'
import { CircleDashed, Clock3, GitBranch, RefreshCw, RotateCcw, TimerReset } from 'lucide-react'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { WorkflowCanvas } from '@/components/workflow-canvas'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cancelWorkflow, getWorkflow, getWorkflowEvents, rerunWorkflow, retryWorkflow, signalWorkflow } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { useCan } from '@/lib/permissions'
import { formatDate, shortIdentifier, workflowLabel, workflowStatusLabel } from '@/lib/formatters'
import { formatUnitPath } from '@/lib/organization'
import { useOrganization } from '@/lib/organization-context'

const terminalRunStatuses: ReadonlySet<WorkflowExecutionStatus> = new Set([
  WorkflowExecutionStatus.Completed,
  WorkflowExecutionStatus.Failed,
  WorkflowExecutionStatus.Partial,
  WorkflowExecutionStatus.Cancelled,
])

export const Route = createFileRoute('/_app/workflows/$workflowId')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.WorkflowsRead)) throw redirect({ to: '/forbidden' })
  },
  component: WorkflowDetailPage,
})

function WorkflowDetailPage() {
  const { workflowId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { units } = useOrganization()
  const canRun = useCan(Permission.WorkflowsRun)
  const workflow = useQuery({
    queryKey: queryKeys.workflow(workflowId),
    queryFn: () => getWorkflow(workflowId),
    refetchInterval: (query) => query.state.data && terminalRunStatuses.has(query.state.data.status) ? false : 5_000,
  })
  const events = useQuery({
    queryKey: queryKeys.workflowEvents(workflowId),
    queryFn: () => getWorkflowEvents(workflowId),
    enabled: workflow.isSuccess,
    refetchInterval: () => workflow.data && terminalRunStatuses.has(workflow.data.status) ? false : 5_000,
  })
  const approval = useMutation({
    mutationFn: () => signalWorkflow(workflowId, {
      contractVersion: ContractVersion.WorkflowSignal,
      signalName: WorkflowSignalName.BlueprintApproval,
      signalId: `dashboard-approval-${Date.now()}`,
      payload: { stepId: 'workflow', approved: true },
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workflow(workflowId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workflowEvents(workflowId) }),
      ])
    },
  })
  const cancellation = useMutation({
    mutationFn: () => cancelWorkflow(workflowId),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.workflow(workflowId) }), queryClient.invalidateQueries({ queryKey: queryKeys.workflowEvents(workflowId) }), queryClient.invalidateQueries({ queryKey: queryKeys.workflows() })]) },
  })
  const control = useMutation({
    mutationFn: (action: typeof WorkflowSignalName.WorkflowPause | typeof WorkflowSignalName.WorkflowResume) => signalWorkflow(workflowId, {
      contractVersion: ContractVersion.WorkflowSignal,
      signalName: action,
      signalId: `dashboard-${action}-${Date.now()}`,
      payload: {},
    }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.workflow(workflowId) }), queryClient.invalidateQueries({ queryKey: queryKeys.workflowEvents(workflowId) }), queryClient.invalidateQueries({ queryKey: queryKeys.workflows() })]) },
  })
  const rerun = useMutation({
    mutationFn: () => rerunWorkflow(workflowId),
    onSuccess: async (nextWorkflow) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workflows() })
      await navigate({ to: '/workflows/$workflowId', params: { workflowId: nextWorkflow.workflowId } })
    },
  })
  const retry = useMutation({
    mutationFn: () => retryWorkflow(workflowId),
    onSuccess: async (nextWorkflow) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workflows() })
      await navigate({ to: '/workflows/$workflowId', params: { workflowId: nextWorkflow.workflowId } })
    },
  })
  const eventRows = events.data ?? []
  const activityRows = eventRows.filter((event) => event.activityName && event.eventType.startsWith('activity_'))
  const transitionCount = eventRows.filter((event) => event.eventType === 'workflow_status_updated').length
  const evidenceRows = eventRows.flatMap((event) => {
    const refs = event.evidence?.map((item) => item.reference) ?? (event.evidenceRef ? [event.evidenceRef] : Array.isArray(event.metadata.evidenceRefs) ? event.metadata.evidenceRefs.filter((ref): ref is string => typeof ref === 'string') : [])
    return refs.map((reference) => ({ event, reference }))
  })
  const traceDurations = eventRows.map((event) => event.trace?.durationMs ?? metadataNumber(event, 'durationMs')).filter((value): value is number => value !== undefined)
  const traceAttempts = eventRows.map((event) => event.trace?.attempt ?? metadataNumber(event, 'attempt')).filter((value): value is number => value !== undefined)
  const traceProviders = [...new Set(eventRows.map((event) => event.trace?.provider ?? metadataString(event, 'provider')).filter((value): value is string => Boolean(value)))]
  const traceModels = [...new Set(eventRows.map((event) => event.trace?.model ?? metadataString(event, 'model')).filter((value): value is string => Boolean(value)))]
  const traceBudget = eventRows.map((event) => event.trace?.budget ?? metadataString(event, 'budget')).find(Boolean)
  const traceRows = eventRows.filter((event) => Boolean(event.trace || event.agentRunId || event.evidence?.length || event.evidenceRef))

  if (workflow.isLoading) return <p className="text-sm text-muted-foreground">Loading workflow run…</p>
  if (workflow.isError || !workflow.data) return <div className="flex flex-col gap-6"><PageHeader title="Workflow run unavailable" description="The run could not be loaded in the current organization scope." /><Card><CardContent className="flex flex-col gap-4 pt-6"><p className="text-sm text-destructive">{workflow.error?.message ?? 'Encois returned no workflow projection.'}</p><Button type="button" variant="outline" onClick={() => void workflow.refetch()}>Try again</Button></CardContent></Card></div>
  const status = workflow.data.status

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={workflow.data ? workflowLabel(workflow.data.blueprintId, workflow.data.workflowType) : 'Workflow run'}
        description={<><ProductTerm term="run" /> detail, live state, and <ProductTerm term="evidence" /> collection for the current scope.</>}
        actions={<div className="flex flex-wrap items-center gap-2">{status === WorkflowExecutionStatus.Waiting && canRun ? <Button onClick={() => approval.mutate()} disabled={approval.isPending}>{approval.isPending ? 'Approving…' : 'Approve current pause'}</Button> : null}{canRun && new Set<WorkflowExecutionStatus>([WorkflowExecutionStatus.Queued, WorkflowExecutionStatus.Running, WorkflowExecutionStatus.Waiting]).has(status) ? <Button variant="outline" onClick={() => control.mutate(WorkflowSignalName.WorkflowPause)} disabled={control.isPending}>{control.isPending ? 'Pausing…' : 'Pause run'}</Button> : null}{canRun && status === WorkflowExecutionStatus.Paused ? <Button onClick={() => control.mutate(WorkflowSignalName.WorkflowResume)} disabled={control.isPending}>{control.isPending ? 'Resuming…' : 'Resume run'}</Button> : null}{canRun && new Set<WorkflowExecutionStatus>([WorkflowExecutionStatus.Queued, WorkflowExecutionStatus.Running, WorkflowExecutionStatus.Waiting, WorkflowExecutionStatus.Paused]).has(status) ? <Button variant="outline" onClick={() => { if (window.confirm('Cancel this workflow run? This cannot be undone.')) cancellation.mutate() }} disabled={cancellation.isPending}>{cancellation.isPending ? 'Cancelling…' : 'Cancel run'}</Button> : null}{canRun && new Set<WorkflowExecutionStatus>([WorkflowExecutionStatus.Completed, WorkflowExecutionStatus.Cancelled]).has(status) ? <Button variant="outline" onClick={() => rerun.mutate()} disabled={rerun.isPending}>{rerun.isPending ? 'Starting again…' : 'Run again'}</Button> : null}{canRun && new Set<WorkflowExecutionStatus>([WorkflowExecutionStatus.Partial, WorkflowExecutionStatus.Failed]).has(status) ? <Button variant="outline" onClick={() => retry.mutate()} disabled={retry.isPending}>{retry.isPending ? 'Retrying…' : 'Retry failed work'}</Button> : null}</div>}
      />

      {approval.isError ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">Could not approve this run: {approval.error.message}</div> : null}
      {approval.isSuccess ? <div role="status" className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">Approval signal accepted. The run will refresh as execution processes it.</div> : null}
      {cancellation.isSuccess ? <div role="status" className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">Cancellation requested. The run will refresh as execution confirms the terminal state.</div> : null}
      {cancellation.isError ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{cancellation.error.message}</div> : null}
      {rerun.isError ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">Could not start this workflow again: {rerun.error.message}</div> : null}
      {control.isError ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">Could not change run control: {control.error.message}</div> : null}
      {retry.isError ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">Could not retry this run: {retry.error.message}</div> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Status" value={status ? workflowStatusLabel(status, workflow.data?.statusReason) : workflow.isLoading ? 'Loading' : 'Unavailable'} icon={CircleDashed} />
        <SummaryCard label="Blueprint" value={workflow.data ? workflowLabel(workflow.data.blueprintId, workflow.data.workflowType) : 'Not available'} icon={GitBranch} />
        <SummaryCard label="Revision" value={workflow.data?.blueprintVersion ?? 'Not recorded'} icon={RotateCcw} mono />
        <SummaryCard label="Started" value={formatDate(workflow.data?.createdAt)} icon={Clock3} />
        <SummaryCard label="Transitions" value={events.isLoading ? '…' : String(transitionCount)} icon={TimerReset} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground"><span>Updated {formatDate(workflow.data?.updatedAt)}</span><span>Retention until {formatDate(workflow.data?.retentionUntil)}</span><span>Events are scoped to your current permissions.</span>{workflow.data?.parentWorkflowId ? <span>Rerun of {shortIdentifier(workflow.data.parentWorkflowId)}</span> : null}<details><summary className="cursor-pointer underline underline-offset-2">Technical identifiers</summary><div className="mt-2 rounded-md border bg-muted/30 p-3 font-mono">Workflow: {workflowId}<br />Run: {workflow.data?.runId ?? 'not available'}<br />Blueprint: {workflow.data?.blueprintId ?? 'not available'}<br />Revision: {workflow.data?.blueprintVersion ?? 'not available'}<br />Parent: {workflow.data?.parentWorkflowId ?? 'not available'}</div></details></div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle><ProductTerm term="workflow" /> canvas</CardTitle>
            <CardDescription>Topology is derived from emitted step events. It updates as execution reports activity.</CardDescription>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="size-3.5" aria-hidden="true" />
            <span>{terminalRunStatuses.has(status) ? 'Updates stopped after terminal state' : 'Auto-refresh every 5s while active'}</span>
          </div>
        </CardHeader>
        <CardContent>
          <WorkflowCanvas refreshCount={workflow.dataUpdatedAt} lastPolledAt={workflow.dataUpdatedAt ? new Date(workflow.dataUpdatedAt) : null} events={eventRows} runStatus={status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Execution steps</CardTitle>
          <CardDescription>Step activity and specialist work for this <ProductTerm term="run" />.</CardDescription>
        </CardHeader>
        <CardContent>
          {events.isError ? <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-destructive">Could not load step activity: {events.error.message}</p><Button type="button" variant="outline" onClick={() => void events.refetch()}><RefreshCw data-icon="inline-start" />Retry</Button></div> : null}
          {!events.isLoading && !events.isError && activityRows.length === 0 ? <EmptyPanel icon={CircleDashed} title="No step activity yet" description="Detailed step activity will appear here when available." /> : null}
          <div className="flex flex-col gap-2">
            {activityRows.map((event) => <ActivityRow key={event.id} event={event} />)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Execution trace</CardTitle><CardDescription>Operational trace attributes for this Run: lifecycle, activity, agent, evidence, and bounded metadata.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><TraceMetric label="Trace records" value={String(traceRows.length)} /><TraceMetric label="Agent runs" value={String(new Set(eventRows.map((event) => event.agentRunId).filter(Boolean)).size)} /><TraceMetric label="Evidence links" value={String(evidenceRows.length)} /><TraceMetric label="Max latency" value={traceDurations.length ? `${Math.max(...traceDurations)} ms` : 'Not reported'} /><TraceMetric label="Max attempt" value={traceAttempts.length ? String(Math.max(...traceAttempts)) : 'Not reported'} /></div><div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>Provider: {traceProviders.join(', ') || 'Not reported'}</span><span>Model: {traceModels.join(', ') || 'Not reported'}</span><span>Budget: {traceBudget || 'Not reported'}</span></div>{traceRows.length ? traceRows.map((event) => <TraceRow key={`trace-${event.id}`} event={event} />) : <EmptyPanel icon={CircleDashed} title="No runtime trace attributes yet" description={eventRows.length ? 'Execution events are available below. Provider, model, latency, and retry details will appear when the runtime emits them.' : 'The runtime will expose trace attributes as the Run progresses.'} />}</CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle><ProductTerm term="evidence" /> records</CardTitle><CardDescription>Each reference is shown with the provenance fields returned by execution. Missing provider metadata remains visible as unavailable.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-2">
          {!events.isLoading && !events.isError && evidenceRows.length === 0 ? <EmptyPanel icon={CircleDashed} title="No evidence references yet" description="Evidence records will appear when a tool or agent returns a source reference." /> : null}
          {evidenceRows.map(({ event, reference }) => <EvidenceRow key={`${event.id}-${reference}`} event={event} reference={reference} units={units} />)}
        </CardContent>
      </Card>

      <Card>
          <CardHeader>
          <CardTitle>Event history</CardTitle>
          <CardDescription>State transitions, retries, and execution events for this <ProductTerm term="run" />.</CardDescription>
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

function EvidenceRow({ event, reference, units }: { event: WorkflowEventProjection; reference: string; units: ReturnType<typeof useOrganization>['units'] }) {
  const projection = event.evidence?.find((item) => item.reference === reference)
  const rawProvenance = isJsonObject(event.metadata.provenance) ? event.metadata.provenance : undefined
  const provenance = projection?.provenance ?? rawProvenance ?? event.metadata
  const source = typeof provenance.source === 'string' ? provenance.source : 'Not reported'
  const sourceRecordId = typeof provenance.sourceRecordId === 'string' ? provenance.sourceRecordId : undefined
  const observedAt = typeof provenance.observedAt === 'string' ? provenance.observedAt : undefined
  const ingestedAt = typeof provenance.ingestedAt === 'string' ? provenance.ingestedAt : undefined
  const transformationVersion = typeof provenance.transformationVersion === 'string' ? provenance.transformationVersion : undefined
  const confidence = projection?.confidence ?? (typeof rawProvenance?.confidence === 'number' ? rawProvenance.confidence : undefined)
  const freshness = projection?.freshness
  const visibilityScope = Array.isArray(provenance.visibilityScope) ? provenance.visibilityScope.map((id) => formatUnitPath(units, id) || id).join(', ') : 'Scope enforced by Encois'
  const freshnessLabel = freshness ? `${freshness.status}${freshness.expiresAt ? ` · until ${formatDate(freshness.expiresAt)}` : ''}` : 'Not reported'
  return <div className="rounded-lg border p-3 text-sm"><div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4"><div className="min-w-0"><p className="break-all font-mono text-xs">{reference}</p><p className="mt-1 text-xs text-muted-foreground">Produced by {event.activityName ?? event.eventType} · {formatDate(event.occurredAt)}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs ${confidence === undefined ? 'bg-muted text-muted-foreground' : 'bg-secondary'}`}>Confidence {formatConfidence(confidence)}</span></div><dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2"><div><dt className="text-muted-foreground">Source</dt><dd className="font-medium">{source}</dd></div><div><dt className="text-muted-foreground">Source record</dt><dd className="font-mono">{sourceRecordId ?? 'Not reported'}</dd></div><div><dt className="text-muted-foreground">Observed</dt><dd>{formatDate(observedAt)}</dd></div><div><dt className="text-muted-foreground">Ingested</dt><dd>{formatDate(ingestedAt)}</dd></div><div><dt className="text-muted-foreground">Transformation</dt><dd>{transformationVersion ?? 'Not reported'}</dd></div><div><dt className="text-muted-foreground">Freshness</dt><dd>{freshnessLabel}</dd></div><div><dt className="text-muted-foreground">Scope</dt><dd>{visibilityScope}</dd></div></dl></div>
}

function formatConfidence(value: number | undefined): string {
  if (value === undefined) return 'Not reported'
  if (!Number.isFinite(value)) return 'Invalid value'
  if (value >= 0 && value <= 1) return `${Math.round(value * 100)}%`
  if (value >= 0 && value <= 100) return `${Math.round(value)}%`
  return 'Invalid value'
}

function metadataNumber(event: WorkflowEventProjection, key: string): number | undefined {
  return typeof event.metadata[key] === 'number' && Number.isFinite(event.metadata[key]) ? event.metadata[key] as number : undefined
}

function metadataString(event: WorkflowEventProjection, key: string): string | undefined {
  return typeof event.metadata[key] === 'string' && event.metadata[key] ? event.metadata[key] as string : undefined
}

function TraceMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-muted/20 px-3 py-2"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>
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

function TraceRow({ event }: { event: import('@encois/contracts').WorkflowEventProjection }) {
  const metadata = Object.entries(event.metadata).filter(([key]) => !key.toLowerCase().includes('prompt')).slice(0, 8)
  const provider = event.trace?.provider ?? metadataString(event, 'provider') ?? 'Not reported'
  const model = event.trace?.model ?? metadataString(event, 'model') ?? 'Not reported'
  const durationMs = event.trace?.durationMs ?? metadataNumber(event, 'durationMs')
  const attempt = event.trace?.attempt ?? metadataNumber(event, 'attempt')
  const outcome = event.trace?.outcome ?? metadataString(event, 'outcome') ?? 'Not reported'
  const budget = event.trace?.budget ?? metadataString(event, 'budget') ?? 'Not reported'
  const redacted = event.trace?.redacted ?? metadataBoolean(event, 'redacted')
  return <div className="rounded-lg border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{event.eventType}</span><span className="text-xs text-muted-foreground">{formatDate(event.occurredAt)}</span></div><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{event.status}</span>{event.activityName ? <span>activity: {event.activityName}</span> : null}{event.agentRunId ? <span>agent: {shortIdentifier(event.agentRunId)}</span> : null}{event.evidenceRef ? <span>evidence linked</span> : null}<span>provider: {provider}</span><span>model: {model}</span><span>latency: {durationMs !== undefined ? `${durationMs}ms` : 'Not reported'}</span><span>attempt: {attempt !== undefined ? attempt : 'Not reported'}</span><span>outcome: {outcome}</span><span>budget: {budget}</span><span>redaction: {redacted === undefined ? 'Not reported' : redacted ? 'applied' : 'not applied'}</span></div>{metadata.length ? <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Trace metadata</summary><div className="mt-2 flex flex-wrap gap-2">{metadata.map(([key, value]) => <span key={key} className="rounded bg-muted px-2 py-1">{key}: {typeof value === 'string' ? value : JSON.stringify(value)}</span>)}</div></details> : null}</div>
}

function metadataBoolean(event: import('@encois/contracts').WorkflowEventProjection, key: string): boolean | undefined {
  return typeof event.metadata[key] === 'boolean' ? event.metadata[key] as boolean : undefined
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
