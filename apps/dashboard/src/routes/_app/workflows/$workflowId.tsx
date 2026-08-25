import {
  ContractVersion,
  isJsonObject,
  Permission,
  TemporalWorkflowType,
  type WorkflowEventProjection,
  type WorkflowExecutionProjection,
  WorkflowExecutionStatus,
  WorkflowSignalName,
  type WorkflowStatusReason,
} from "@encois/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { CircleDashed, FileText, RefreshCw } from "lucide-react";
import { EmptyPanel } from "@/components/empty-panel";
import { InlineError } from "@/components/inline-error";
import { PageHeader } from "@/components/page-header";
import { ProductTerm } from "@/components/product-term";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WorkflowCanvas } from "@/components/workflow-canvas";
import { WorkflowStatusIndicator } from "@/components/workflow-status";
import {
  cancelWorkflow,
  getWorkflow,
  getWorkflowEvents,
  rerunWorkflow,
  signalWorkflow,
} from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import {
  formatDate,
  humanizeKey,
  shortIdentifier,
  workflowLabel,
  workflowStatusLabel,
} from "@/lib/formatters";
import { formatUnitPath } from "@/lib/organization";
import { useOrganization } from "@/lib/organization-context";
import { useCan } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";

const terminalRunStatuses: ReadonlySet<WorkflowExecutionStatus> = new Set([
  WorkflowExecutionStatus.Completed,
  WorkflowExecutionStatus.Failed,
  WorkflowExecutionStatus.Partial,
  WorkflowExecutionStatus.Cancelled,
]);

export const Route = createFileRoute("/_app/workflows/$workflowId")({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.WorkflowsRead))
      throw redirect({ to: "/forbidden" });
  },
  component: WorkflowDetailPage,
});

function WorkflowDetailPage() {
  const { workflowId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { units } = useOrganization();
  const canRun = useCan(Permission.WorkflowsRun);
  const workflow = useQuery({
    queryKey: queryKeys.workflow(workflowId),
    queryFn: () => getWorkflow(workflowId),
    refetchInterval: (query) =>
      query.state.data && terminalRunStatuses.has(query.state.data.status)
        ? false
        : 5_000,
  });
  const events = useQuery({
    queryKey: queryKeys.workflowEvents(workflowId),
    queryFn: () => getWorkflowEvents(workflowId),
    enabled: workflow.isSuccess,
    refetchInterval: () =>
      workflow.data && terminalRunStatuses.has(workflow.data.status)
        ? false
        : 5_000,
  });
  const approval = useMutation({
    mutationFn: () =>
      signalWorkflow(workflowId, {
        contractVersion: ContractVersion.WorkflowSignal,
        signalName: WorkflowSignalName.BlueprintApproval,
        signalId: `dashboard-approval-${Date.now()}`,
        payload: { stepId: "workflow", approved: true },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflow(workflowId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowEvents(workflowId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowRunListRoot(),
        }),
      ]);
    },
  });
  const cancellation = useMutation({
    mutationFn: () => cancelWorkflow(workflowId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflow(workflowId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowEvents(workflowId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workflows() }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowRunListRoot(),
        }),
      ]);
    },
  });
  const control = useMutation({
    mutationFn: (
      action:
        | typeof WorkflowSignalName.WorkflowPause
        | typeof WorkflowSignalName.WorkflowResume,
    ) =>
      signalWorkflow(workflowId, {
        contractVersion: ContractVersion.WorkflowSignal,
        signalName: action,
        signalId: `dashboard-${action}-${Date.now()}`,
        payload: {},
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflow(workflowId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowEvents(workflowId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workflows() }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowRunListRoot(),
        }),
      ]);
    },
  });
  const rerun = useMutation({
    mutationFn: () => rerunWorkflow(workflowId),
    onSuccess: async (nextWorkflow) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workflows() }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowRunListRoot(),
        }),
      ]);
      await navigate({
        to: "/workflows/$workflowId",
        params: { workflowId: nextWorkflow.workflowId },
      });
    },
  });
  const eventRows = events.data ?? [];
  const activityRows = eventRows.filter(
    (event) => event.activityName && event.eventType.startsWith("activity_"),
  );
  const transitionCount = eventRows.filter(
    (event) => event.eventType === "workflow_status_updated",
  ).length;
  const evidenceRows = eventRows.flatMap((event) => {
    const refs =
      event.evidence?.map((item) => item.reference) ??
      (event.evidenceRef
        ? [event.evidenceRef]
        : Array.isArray(event.metadata.evidenceRefs)
          ? event.metadata.evidenceRefs.filter(
              (ref): ref is string => typeof ref === "string",
            )
          : []);
    return refs.map((reference) => ({ event, reference }));
  });
  const traceDurations = eventRows
    .map(
      (event) => event.trace?.durationMs ?? metadataNumber(event, "durationMs"),
    )
    .filter((value): value is number => value !== undefined);
  const traceAttempts = eventRows
    .map((event) => event.trace?.attempt ?? metadataNumber(event, "attempt"))
    .filter((value): value is number => value !== undefined);
  const traceProviders = [
    ...new Set(
      eventRows
        .map(
          (event) => event.trace?.provider ?? metadataString(event, "provider"),
        )
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const traceModels = [
    ...new Set(
      eventRows
        .map((event) => event.trace?.model ?? metadataString(event, "model"))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const traceBudget = eventRows
    .map((event) => event.trace?.budget ?? metadataString(event, "budget"))
    .find(Boolean);
  const traceRows = eventRows.filter((event) =>
    Boolean(
      event.trace ||
        event.agentRunId ||
        event.evidence?.length ||
        event.evidenceRef,
    ),
  );
  const runOutput = extractWorkflowOutput(eventRows);

  if (workflow.isLoading)
    return (
      <p className="text-sm text-muted-foreground">Loading workflow run…</p>
    );
  if (workflow.isError || !workflow.data)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Workflow run unavailable"
          description="The run could not be loaded in the current organization scope."
        />
        <InlineError
          title="Workflow run unavailable"
          message={
            workflow.error?.message ?? "No workflow projection was returned."
          }
          onRetry={() => workflow.refetch()}
          retrying={workflow.isFetching}
        />
      </div>
    );
  const status = workflow.data.status;
  const isRefreshing = workflow.isFetching || events.isFetching;

  return (
    <div data-testid="workflow-run-page" className="flex flex-col gap-8">
      <PageHeader
        title={
          workflow.data
            ? workflowLabel(
                workflow.data.blueprintId,
                workflow.data.workflowType,
              )
            : "Workflow run"
        }
        description={
          <>
            <ProductTerm term="run" /> detail, live state, and{" "}
            <ProductTerm term="evidence" /> collection for the current scope.
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!terminalRunStatuses.has(status) ? (
              <Button
                variant="outline"
                onClick={() =>
                  void Promise.all([workflow.refetch(), events.refetch()])
                }
                disabled={isRefreshing}
              >
                <RefreshCw
                  className={isRefreshing ? "animate-spin" : undefined}
                  data-icon="inline-start"
                />
                {isRefreshing ? "Fetching…" : "Fetch again"}
              </Button>
            ) : null}
            {status === WorkflowExecutionStatus.Waiting && canRun ? (
              <Button
                onClick={() => approval.mutate()}
                disabled={approval.isPending}
              >
                {approval.isPending ? "Approving…" : "Approve current pause"}
              </Button>
            ) : null}
            {canRun &&
            new Set<WorkflowExecutionStatus>([
              WorkflowExecutionStatus.Queued,
              WorkflowExecutionStatus.Running,
              WorkflowExecutionStatus.Waiting,
            ]).has(status) ? (
              <Button
                variant="outline"
                onClick={() => control.mutate(WorkflowSignalName.WorkflowPause)}
                disabled={control.isPending}
              >
                {control.isPending ? "Pausing…" : "Pause run"}
              </Button>
            ) : null}
            {canRun && status === WorkflowExecutionStatus.Paused ? (
              <Button
                onClick={() =>
                  control.mutate(WorkflowSignalName.WorkflowResume)
                }
                disabled={control.isPending}
              >
                {control.isPending ? "Resuming…" : "Resume run"}
              </Button>
            ) : null}
            {canRun &&
            new Set<WorkflowExecutionStatus>([
              WorkflowExecutionStatus.Queued,
              WorkflowExecutionStatus.Running,
              WorkflowExecutionStatus.Waiting,
              WorkflowExecutionStatus.Paused,
            ]).has(status) ? (
              <Button
                variant="outline"
                onClick={() => {
                  if (
                    window.confirm(
                      "Cancel this workflow run? This cannot be undone.",
                    )
                  )
                    cancellation.mutate();
                }}
                disabled={cancellation.isPending}
              >
                {cancellation.isPending ? "Cancelling…" : "Cancel run"}
              </Button>
            ) : null}
            {canRun &&
            new Set<WorkflowExecutionStatus>([
              WorkflowExecutionStatus.Completed,
              WorkflowExecutionStatus.Cancelled,
            ]).has(status) ? (
              <Button
                variant="outline"
                onClick={() => rerun.mutate()}
                disabled={rerun.isPending}
              >
                {rerun.isPending ? "Starting again…" : "Run again"}
              </Button>
            ) : null}
          </div>
        }
      />

      {approval.isError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          Could not approve this run: {approval.error.message}
        </div>
      ) : null}
      {approval.isSuccess ? (
        <div
          role="status"
          className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary"
        >
          Approval signal accepted. The run will refresh as execution processes
          it.
        </div>
      ) : null}
      {cancellation.isSuccess ? (
        <div
          role="status"
          className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary"
        >
          Cancellation requested. The run will refresh as execution confirms the
          terminal state.
        </div>
      ) : null}
      {cancellation.isError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {cancellation.error.message}
        </div>
      ) : null}
      {rerun.isError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          Could not start this workflow again: {rerun.error.message}
        </div>
      ) : null}
      {control.isError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          Could not change run control: {control.error.message}
        </div>
      ) : null}

      <RunDetailsCard
        workflowId={workflowId}
        workflow={workflow.data}
        providers={traceProviders}
        units={units}
        eventCount={events.isLoading ? undefined : eventRows.length}
        transitionCount={events.isLoading ? undefined : transitionCount}
      />

      <WorkflowOutputCard
        status={status}
        statusReason={workflow.data.statusReason}
        output={runOutput}
      />

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle>
              <ProductTerm term="workflow" /> canvas
            </CardTitle>
            <CardDescription>
              Topology is derived from emitted step events. It updates as
              execution reports activity.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="size-3.5" aria-hidden="true" />
            <span>
              {terminalRunStatuses.has(status)
                ? "Updates stopped after terminal state"
                : "Auto-refresh every 5s while active"}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <WorkflowCanvas
            refreshCount={workflow.dataUpdatedAt}
            lastPolledAt={
              workflow.dataUpdatedAt ? new Date(workflow.dataUpdatedAt) : null
            }
            events={eventRows}
            runStatus={status}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <ProductTerm term="workflowStep" plural />
          </CardTitle>
          <CardDescription>
            Step <ProductTerm term="activity" /> and specialist work for this{" "}
            <ProductTerm term="run" />.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.isError ? (
            <InlineError
              title="Step activity unavailable"
              message={events.error.message}
              onRetry={() => events.refetch()}
              retrying={events.isFetching}
            />
          ) : null}
          {!events.isLoading && !events.isError && activityRows.length === 0 ? (
            <EmptyPanel
              icon={CircleDashed}
              title="No step activity yet"
              description="Detailed step activity will appear here when available."
            />
          ) : null}
          <div className="flex flex-col gap-2">
            {activityRows.map((event) => (
              <ActivityRow key={event.id} event={event} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Execution trace</CardTitle>
          <CardDescription>
            Operational trace attributes for this <ProductTerm term="run" />:
            lifecycle, <ProductTerm term="activity" />,{" "}
            <ProductTerm term="agentRun" />, <ProductTerm term="evidence" />,
            and bounded metadata.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <TraceMetric
              label="Trace records"
              value={String(traceRows.length)}
            />
            <TraceMetric
              label="Agent runs"
              value={String(
                new Set(
                  eventRows.map((event) => event.agentRunId).filter(Boolean),
                ).size,
              )}
            />
            <TraceMetric
              label="Evidence links"
              value={String(evidenceRows.length)}
            />
            <TraceMetric
              label="Max latency"
              value={
                traceDurations.length
                  ? `${Math.max(...traceDurations)} ms`
                  : "Not reported"
              }
            />
            <TraceMetric
              label="Max attempt"
              value={
                traceAttempts.length
                  ? String(Math.max(...traceAttempts))
                  : "Not reported"
              }
            />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Provider: {traceProviders.join(", ") || "Not reported"}</span>
            <span>Model: {traceModels.join(", ") || "Not reported"}</span>
            <span>Budget: {traceBudget || "Not reported"}</span>
          </div>
          {traceRows.length ? (
            traceRows.map((event) => (
              <TraceRow key={`trace-${event.id}`} event={event} />
            ))
          ) : (
            <EmptyPanel
              icon={CircleDashed}
              title="No runtime trace attributes yet"
              description={
                eventRows.length
                  ? "Execution events are available below. Provider, model, latency, and attempt details will appear when the runtime emits them."
                  : "The runtime will expose trace attributes as the Run progresses."
              }
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <ProductTerm term="evidence" /> records
          </CardTitle>
          <CardDescription>
            Each reference is shown with the <ProductTerm term="provenance" />{" "}
            fields returned by execution. Missing provider metadata remains
            visible as unavailable.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {!events.isLoading && !events.isError && evidenceRows.length === 0 ? (
            <EmptyPanel
              icon={CircleDashed}
              title="No evidence references yet"
              description={
                <>
                  <ProductTerm term="evidence" /> records will appear when a{" "}
                  <ProductTerm term="tool" /> or agent returns a source
                  reference.
                </>
              }
            />
          ) : null}
          {evidenceRows.map(({ event, reference }) => (
            <EvidenceRow
              key={`${event.id}-${reference}`}
              event={event}
              reference={reference}
              units={units}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <ProductTerm term="event" plural /> history
          </CardTitle>
          <CardDescription>
            State transitions, retries, and <ProductTerm term="event" plural />{" "}
            for this <ProductTerm term="run" />.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!events.isLoading && !events.isError && eventRows.length === 0 ? (
            <EmptyPanel
              icon={CircleDashed}
              title="No event history yet"
              description={
                <>
                  <ProductTerm term="evidence" /> references, retries, and state
                  transitions will appear here when available.
                </>
              }
            />
          ) : null}
          <div className="flex flex-col gap-2">
            {eventRows.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EvidenceRow({
  event,
  reference,
  units,
}: {
  event: WorkflowEventProjection;
  reference: string;
  units: ReturnType<typeof useOrganization>["units"];
}) {
  const projection = event.evidence?.find(
    (item) => item.reference === reference,
  );
  const rawProvenance = isJsonObject(event.metadata.provenance)
    ? event.metadata.provenance
    : undefined;
  const provenance = projection?.provenance ?? rawProvenance ?? event.metadata;
  const source =
    typeof provenance.source === "string" ? provenance.source : "Not reported";
  const sourceRecordId =
    typeof provenance.sourceRecordId === "string"
      ? provenance.sourceRecordId
      : undefined;
  const observedAt =
    typeof provenance.observedAt === "string"
      ? provenance.observedAt
      : undefined;
  const ingestedAt =
    typeof provenance.ingestedAt === "string"
      ? provenance.ingestedAt
      : undefined;
  const transformationVersion =
    typeof provenance.transformationVersion === "string"
      ? provenance.transformationVersion
      : undefined;
  const confidence =
    projection?.confidence ??
    (typeof rawProvenance?.confidence === "number"
      ? rawProvenance.confidence
      : undefined);
  const freshness = projection?.freshness;
  const visibilityScope = Array.isArray(provenance.visibilityScope)
    ? provenance.visibilityScope
        .map((id) => formatUnitPath(units, id) || id)
        .join(", ")
    : "Scope enforced by current access policy";
  const freshnessLabel = freshness
    ? `${freshness.status}${freshness.expiresAt ? ` · until ${formatDate(freshness.expiresAt)}` : ""}`
    : "Not reported";
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="break-all font-mono text-xs">{reference}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Produced by {event.activityName ?? event.eventType} ·{" "}
            {formatDate(event.occurredAt)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-xs ${confidence === undefined ? "bg-muted text-muted-foreground" : "bg-secondary"}`}
        >
          Confidence {formatConfidence(confidence)}
        </span>
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="font-medium">{source}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Source record</dt>
          <dd className="font-mono">{sourceRecordId ?? "Not reported"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Observed</dt>
          <dd>{formatDate(observedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Ingested</dt>
          <dd>{formatDate(ingestedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Transformation</dt>
          <dd>{transformationVersion ?? "Not reported"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            <ProductTerm term="freshness" />
          </dt>
          <dd>{freshnessLabel}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Scope</dt>
          <dd>{visibilityScope}</dd>
        </div>
      </dl>
    </div>
  );
}

function formatConfidence(value: number | undefined): string {
  if (value === undefined) return "Not reported";
  if (!Number.isFinite(value)) return "Invalid value";
  if (value >= 0 && value <= 1) return `${Math.round(value * 100)}%`;
  if (value >= 0 && value <= 100) return `${Math.round(value)}%`;
  return "Invalid value";
}

function metadataNumber(
  event: WorkflowEventProjection,
  key: string,
): number | undefined {
  return typeof event.metadata[key] === "number" &&
    Number.isFinite(event.metadata[key])
    ? (event.metadata[key] as number)
    : undefined;
}

function metadataString(
  event: WorkflowEventProjection,
  key: string,
): string | undefined {
  return typeof event.metadata[key] === "string" && event.metadata[key]
    ? (event.metadata[key] as string)
    : undefined;
}

function TraceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function ActivityRow({
  event,
}: {
  event: import("@encois/contracts").WorkflowEventProjection;
}) {
  const issue =
    typeof event.metadata.issue === "string" ? event.metadata.issue : undefined;
  const attempt =
    typeof event.metadata.attempt === "number"
      ? `attempt ${event.metadata.attempt}`
      : undefined;
  const shard =
    typeof event.metadata.shard === "string"
      ? `shard ${event.metadata.shard}`
      : undefined;
  const duration =
    typeof event.metadata.durationMs === "number"
      ? `${event.metadata.durationMs}ms`
      : undefined;
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:gap-4">
      <span className="min-w-0 flex-1 font-medium">{event.activityName}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <EventStatus status={event.status} />
        {attempt ? ` · ${attempt}` : ""}
        {shard ? ` · ${shard}` : ""}
        {duration ? ` · ${duration}` : ""}
        {issue ? ` · ${issue}` : ""}
      </span>
      <span className="text-xs text-muted-foreground">
        {formatDate(event.occurredAt)}
      </span>
    </div>
  );
}

function EventRow({
  event,
}: {
  event: import("@encois/contracts").WorkflowEventProjection;
}) {
  const shard =
    typeof event.metadata.shard === "string" ? event.metadata.shard : undefined;
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{event.eventType}</span>
        <span className="text-xs text-muted-foreground">
          {formatDate(event.occurredAt)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <EventStatus status={event.status} />
        {shard ? <span>shard: {shard}</span> : null}
        {event.evidenceRef ? (
          <span className="font-mono">{event.evidenceRef}</span>
        ) : null}
        {event.agentRunId ? (
          <span className="font-mono">{event.agentRunId}</span>
        ) : null}
      </div>
    </div>
  );
}

function TraceRow({
  event,
}: {
  event: import("@encois/contracts").WorkflowEventProjection;
}) {
  const metadata = Object.entries(event.metadata)
    .filter(([key]) => !key.toLowerCase().includes("prompt"))
    .slice(0, 8);
  const provider =
    event.trace?.provider ??
    metadataString(event, "provider") ??
    "Not reported";
  const model =
    event.trace?.model ?? metadataString(event, "model") ?? "Not reported";
  const durationMs =
    event.trace?.durationMs ?? metadataNumber(event, "durationMs");
  const attempt = event.trace?.attempt ?? metadataNumber(event, "attempt");
  const outcome =
    event.trace?.outcome ?? metadataString(event, "outcome") ?? "Not reported";
  const budget =
    event.trace?.budget ?? metadataString(event, "budget") ?? "Not reported";
  const redacted = event.trace?.redacted ?? metadataBoolean(event, "redacted");
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{event.eventType}</span>
        <span className="text-xs text-muted-foreground">
          {formatDate(event.occurredAt)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <EventStatus status={event.status} />
        {event.activityName ? (
          <span>activity: {event.activityName}</span>
        ) : null}
        {event.agentRunId ? (
          <span>agent: {shortIdentifier(event.agentRunId)}</span>
        ) : null}
        {event.evidenceRef ? <span>evidence linked</span> : null}
        <span>provider: {provider}</span>
        <span>model: {model}</span>
        <span>
          latency:{" "}
          {durationMs !== undefined ? `${durationMs}ms` : "Not reported"}
        </span>
        <span>attempt: {attempt !== undefined ? attempt : "Not reported"}</span>
        <span>outcome: {outcome}</span>
        <span>budget: {budget}</span>
        <span>
          redaction:{" "}
          {redacted === undefined
            ? "Not reported"
            : redacted
              ? "applied"
              : "not applied"}
        </span>
      </div>
      {metadata.length ? (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Trace metadata</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {metadata.map(([key, value]) => (
              <span key={key} className="rounded bg-muted px-2 py-1">
                {key}:{" "}
                {typeof value === "string" ? value : JSON.stringify(value)}
              </span>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function EventStatus({ status }: { status: string }) {
  const knownStatus = Object.values(WorkflowExecutionStatus).find(
    (value) => value === status,
  );
  return knownStatus ? (
    <WorkflowStatusIndicator status={knownStatus} compact />
  ) : (
    <span>{status}</span>
  );
}

function metadataBoolean(
  event: import("@encois/contracts").WorkflowEventProjection,
  key: string,
): boolean | undefined {
  return typeof event.metadata[key] === "boolean"
    ? (event.metadata[key] as boolean)
    : undefined;
}

type WorkflowOutput = {
  text: string;
  activityName?: string;
  occurredAt: string;
};

function RunDetailsCard({
  workflowId,
  workflow,
  providers,
  units,
  eventCount,
  transitionCount,
}: {
  workflowId: string;
  workflow: WorkflowExecutionProjection;
  providers: readonly string[];
  units: ReturnType<typeof useOrganization>["units"];
  eventCount?: number;
  transitionCount?: number;
}) {
  const semanticWorkflowType = formatWorkflowType(workflow, providers);
  const scopeIds = workflow.scope?.ids ?? [];
  const scopeLabel = scopeIds.length
    ? scopeIds.map((id) => formatUnitPath(units, id) || id).join(", ")
    : "Not reported";
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Run details</CardTitle>
          <CardDescription>
            Execution state, Temporal metadata, and scope-aware run history.
          </CardDescription>
        </div>
        <WorkflowStatusIndicator
          testId="workflow-run-status"
          status={workflow.status}
          reason={workflow.statusReason}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <DetailField
            label="Blueprint"
            value={workflowLabel(workflow.blueprintId, workflow.workflowType)}
          />
          <DetailField
            label="Revision"
            value={workflow.blueprintVersion ?? "Not recorded"}
            mono
          />
          <DetailField label="Started" value={formatDate(workflow.createdAt)} />
          <DetailField label="Updated" value={formatDate(workflow.updatedAt)} />
          <DetailField
            label="Finished"
            value={formatDate(workflow.completedAt)}
          />
          <DetailField
            label="Retention"
            value={formatDate(workflow.retentionUntil)}
          />
          <DetailField
            label="Event records"
            value={eventCount === undefined ? "Loading…" : String(eventCount)}
          />
          <DetailField
            label="Status transitions"
            value={
              transitionCount === undefined
                ? "Loading…"
                : String(transitionCount)
            }
          />
        </dl>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-xs text-muted-foreground">
          <span>
            Org:{" "}
            <span className="font-mono" title={workflow.organizationId}>
              {shortIdentifier(workflow.organizationId, 18)}
            </span>
          </span>
          <span>
            Org unit:{" "}
            <span title={scopeLabel}>
              {scopeIds.length === 1
                ? scopeLabel
                : scopeIds.length
                  ? `${scopeIds.length} units`
                  : "Not reported"}
            </span>
          </span>
          <span>
            Workflow type: <span>{semanticWorkflowType}</span>
          </span>
          <span>
            Namespace: <span className="font-mono">{workflow.namespace}</span>
          </span>
          <span>
            Task queue: <span className="font-mono">{workflow.taskQueue}</span>
          </span>
          <span>Events are scoped to your current permissions.</span>
          {workflow.parentWorkflowId ? (
            <span>Rerun of {shortIdentifier(workflow.parentWorkflowId)}</span>
          ) : null}
          <details>
            <summary className="cursor-pointer underline underline-offset-2">
              Technical identifiers
            </summary>
            <div className="mt-2 rounded-md border bg-muted/30 p-3 font-mono">
              <div>Org ID: {workflow.organizationId}</div>
              <div>
                Org unit IDs:{" "}
                {scopeIds.length ? scopeIds.join(", ") : "not reported"}
              </div>
              <div>Workflow type: {semanticWorkflowType}</div>
              <div>Temporal type: {workflow.workflowType}</div>
              <div>Run ID: {workflow.runId ?? "not available"}</div>
              <details className="mt-2">
                <summary className="cursor-pointer font-sans underline underline-offset-2">
                  Full Temporal IDs
                </summary>
                <div className="mt-2">Workflow ID: {workflowId}</div>
              </details>
              <div>Blueprint: {workflow.blueprintId ?? "not available"}</div>
              <div>
                Revision: {workflow.blueprintVersion ?? "not available"}
              </div>
              <div>Parent: {workflow.parentWorkflowId ?? "not available"}</div>
            </div>
          </details>
        </div>
      </CardContent>
    </Card>
  );
}

function formatWorkflowType(
  workflow: WorkflowExecutionProjection,
  providers: readonly string[],
): string {
  const provider = providers[0];
  if (provider) return `Encois · ${humanizeKey(provider)} workflow`;
  if (workflow.workflowType === TemporalWorkflowType.Dynamic)
    return "Encois · Dynamic workflow";
  return `Encois · ${humanizeKey(workflow.workflowType)}`;
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          mono
            ? "mt-1 truncate font-mono text-sm font-medium"
            : "mt-1 truncate text-sm font-medium"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function WorkflowOutputCard({
  status,
  statusReason,
  output,
}: {
  status: WorkflowExecutionStatus;
  statusReason?: WorkflowStatusReason;
  output?: WorkflowOutput;
}) {
  const terminal = terminalRunStatuses.has(status);
  const title = output
    ? status === WorkflowExecutionStatus.Partial
      ? "Partial output"
      : "Output available"
    : status === WorkflowExecutionStatus.Failed
      ? "No output · Run failed"
      : terminal
        ? "No output returned"
        : "Output pending";
  const description = output
    ? `Read-only result from ${output.activityName ?? "the workflow run"}.`
    : status === WorkflowExecutionStatus.Failed
      ? "The run ended before an output was returned."
      : terminal
        ? "The run completed without a readable agent output."
        : "Agent output will appear here as the run reports a result.";

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/30">
            <FileText
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          </span>
          <div>
            <CardTitle>Output</CardTitle>
            <CardDescription>
              Primary read-only result produced by the workflow agents.
            </CardDescription>
          </div>
        </div>
        <WorkflowStatusIndicator
          testId="workflow-output-status"
          status={status}
          reason={statusReason}
          compact
        />
      </CardHeader>
      <CardContent>
        <div
          className={
            output
              ? "rounded-lg border bg-background p-4"
              : "rounded-lg border border-dashed bg-muted/20 p-4"
          }
        >
          <p
            data-testid="workflow-output-title"
            className="text-sm font-medium"
          >
            {title}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          {output ? (
            <>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-foreground">
                {output.text}
              </p>
              <p className="mt-4 text-xs text-muted-foreground">
                Produced {formatDate(output.occurredAt)}
              </p>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function extractWorkflowOutput(
  events: readonly WorkflowEventProjection[],
): WorkflowOutput | undefined {
  for (const event of [...events].reverse()) {
    const data = isJsonObject(event.metadata.data)
      ? event.metadata.data
      : undefined;
    const text = data ? extractOutputText(data) : undefined;
    if (text)
      return {
        text,
        ...(event.activityName ? { activityName: event.activityName } : {}),
        occurredAt: event.occurredAt,
      };
  }
  return undefined;
}

function extractOutputText(
  value: Record<string, unknown>,
  depth = 0,
): string | undefined {
  if (depth > 2) return undefined;
  for (const key of [
    "summary",
    "output",
    "result",
    "text",
    "message",
    "content",
  ]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim())
      return candidate.trim();
    if (isJsonObject(candidate)) {
      const nested = extractOutputText(candidate, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}
