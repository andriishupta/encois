import {
  type IntegrationProjection,
  IntegrationStatus,
  type KnowledgeSource,
  KnowledgeSourceStatus,
  type MemoryChangeRecord,
  type OrganizationAccessRequestRecord,
  Permission,
  type WorkflowBlueprintProjection,
  type WorkflowExecutionProjection,
  WorkflowExecutionStatus,
  type WorkflowPlannerVersionProjection,
  type WorkflowPlanRecord,
  type WorkflowStep,
} from "@encois/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  ArrowUpRight,
  BrainCircuit,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  type Clock3,
  GitBranch,
  PlugZap,
  RefreshCw,
  UserRound,
  Waypoints,
} from "lucide-react";
import { useState } from "react";
import { EmptyPanel } from "@/components/empty-panel";
import { InlineError } from "@/components/inline-error";
import { PageHeader } from "@/components/page-header";
import { DescriptionPill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WorkflowStatusIndicator } from "@/components/workflow-status";
import {
  applyMemoryChange,
  applyOrganizationAccessRequest,
  applyWorkflowPlan,
  approveMemoryChange,
  approveOrganizationAccessRequest,
  approveWorkflowPlan,
  listIntegrations,
  listKnowledgeSources,
  listMemoryChanges,
  listOrganizationAccessRequests,
  listWorkflowBlueprints,
  listWorkflowPlannerVersions,
  listWorkflowPlans,
  listWorkflows,
  rejectMemoryChange,
  rejectOrganizationAccessRequest,
} from "@/lib/api";
import { getAuthIdentity, getAuthSession, hasPermission } from "@/lib/auth";
import {
  formatDate,
  workflowLabel,
  workflowStatusLabel,
} from "@/lib/formatters";
import { useOrganization } from "@/lib/organization-context";
import { usePermissions } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/activity")({
  beforeLoad: () => {
    const session = getAuthSession();
    const canReview = [
      Permission.WorkflowsRead,
      Permission.IntegrationsRead,
      Permission.KnowledgeRead,
      Permission.MemoryRead,
      Permission.OrganizationRead,
    ].some((permission) => hasPermission(session, permission));
    if (!canReview) throw redirect({ to: "/forbidden" });
  },
  component: ActivityPage,
});

function ActivityPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { members } = useOrganization();
  const identity = getAuthIdentity();
  const session = getAuthSession();
  const currentMember = members.find(
    (member) =>
      member.id === session?.userId ||
      (identity.email &&
        member.email.toLowerCase() === identity.email.toLowerCase()),
  );
  const isOrganizationAdministrator =
    currentMember?.roleKey === "organization_admin";
  const canViewWorkflows = can(Permission.WorkflowsRead);
  const canManageWorkflows = can(Permission.WorkflowsManage);
  const canViewSources = can(Permission.KnowledgeRead);
  const canViewIntegrations = can(Permission.IntegrationsRead);
  const canManageMemory = can(Permission.MemoryManage);
  const workflows = useQuery({
    queryKey: queryKeys.workflows(),
    queryFn: listWorkflows,
    enabled: canViewWorkflows,
  });
  const sources = useQuery({
    queryKey: queryKeys.sources(),
    queryFn: listKnowledgeSources,
    enabled: canViewSources,
  });
  const integrations = useQuery({
    queryKey: queryKeys.integrations(),
    queryFn: listIntegrations,
    enabled: canViewIntegrations,
  });
  const plans = useQuery({
    queryKey: queryKeys.workflowPlans(),
    queryFn: () => listWorkflowPlans(),
    enabled: canManageWorkflows,
  });
  const plannerVersions = useQuery({
    queryKey: queryKeys.workflowPlannerVersions(),
    queryFn: () => listWorkflowPlannerVersions(),
    enabled: canManageWorkflows,
  });
  const memoryChanges = useQuery({
    queryKey: queryKeys.memoryChanges(),
    queryFn: () => listMemoryChanges(),
    enabled: canManageMemory,
  });
  const canViewOrganization = can(Permission.OrganizationRead);
  const accessRequests = useQuery({
    queryKey: queryKeys.organizationAccessRequests(),
    queryFn: listOrganizationAccessRequests,
    enabled: canViewOrganization,
  });
  const blueprints = useQuery({
    queryKey: queryKeys.workflowBlueprints(),
    queryFn: listWorkflowBlueprints,
    enabled: canManageWorkflows,
  });
  const [planActionError, setPlanActionError] = useState<string | null>(null);
  const approvePlan = useMutation({
    mutationFn: approveWorkflowPlan,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflowPlansRoot(),
      }),
    onError: (error) => setPlanActionError(error.message),
  });
  const applyPlan = useMutation({
    mutationFn: applyWorkflowPlan,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowPlansRoot(),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowBlueprintsRoot(),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workflows() }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowRunListRoot(),
        }),
      ]);
    },
    onError: (error) => setPlanActionError(error.message),
  });
  const [memoryActionError, setMemoryActionError] = useState<string | null>(
    null,
  );
  const approveMemoryChangeMutation = useMutation({
    mutationFn: approveMemoryChange,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.memoryChanges() }),
    onError: (error) => setMemoryActionError(error.message),
  });
  const rejectMemoryChangeMutation = useMutation({
    mutationFn: rejectMemoryChange,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.memoryChanges() }),
    onError: (error) => setMemoryActionError(error.message),
  });
  const applyMemoryChangeMutation = useMutation({
    mutationFn: applyMemoryChange,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.memoryChanges() }),
    onError: (error) => setMemoryActionError(error.message),
  });
  const [accessRequestActionError, setAccessRequestActionError] = useState<
    string | null
  >(null);
  const accessRequestMutation = useMutation({
    mutationFn: async ({
      id,
      action,
    }: {
      id: string;
      action: "approve" | "reject" | "apply";
    }) => {
      if (action === "approve") return approveOrganizationAccessRequest(id);
      if (action === "reject") return rejectOrganizationAccessRequest(id);
      return applyOrganizationAccessRequest(id);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.organizationAccessRequests(),
      }),
    onError: (error) => setAccessRequestActionError(error.message),
  });

  const waitingRuns =
    workflows.data?.filter(
      (workflow) => workflow.status === WorkflowExecutionStatus.Waiting,
    ) ?? [];
  const runningRuns =
    workflows.data?.filter(
      (workflow) =>
        workflow.status === WorkflowExecutionStatus.Queued ||
        workflow.status === WorkflowExecutionStatus.Running ||
        workflow.status === WorkflowExecutionStatus.Paused,
    ) ?? [];
  const failedRuns =
    workflows.data?.filter(
      (workflow) =>
        workflow.status === WorkflowExecutionStatus.Failed ||
        workflow.status === WorkflowExecutionStatus.Partial,
    ) ?? [];
  const unhealthySources =
    sources.data?.filter((source) =>
      new Set<KnowledgeSourceStatus>([
        KnowledgeSourceStatus.Degraded,
        KnowledgeSourceStatus.NeedsReauth,
        KnowledgeSourceStatus.Failed,
      ]).has(source.status),
    ) ?? [];
  const pendingIntegrations =
    integrations.data?.filter(
      (integration) =>
        !new Set<IntegrationStatus>([
          IntegrationStatus.Active,
          IntegrationStatus.Disabled,
        ]).has(integration.status),
    ) ?? [];
  const pendingPlans =
    plans.data?.filter(
      (plan) => plan.status === "proposed" || plan.status === "approved",
    ) ?? [];
  const pendingMemoryChanges =
    memoryChanges.data?.filter(
      (change) => change.status === "proposed" || change.status === "approved",
    ) ?? [];
  const pendingAccessRequests =
    accessRequests.data?.filter(
      (request) =>
        request.status === "proposed" || request.status === "approved",
    ) ?? [];
  const environmentAttention = aggregateMetric(
    [sources, integrations],
    [unhealthySources.length, pendingIntegrations.length],
  );
  const decisionAttention = aggregateMetric(
    [workflows, plans, memoryChanges, accessRequests],
    [
      waitingRuns.length,
      pendingPlans.length,
      pendingMemoryChanges.length,
      pendingAccessRequests.length,
    ],
  );
  const attentionCount =
    waitingRuns.length +
    failedRuns.length +
    unhealthySources.length +
    pendingIntegrations.length +
    pendingPlans.length +
    pendingMemoryChanges.length +
    pendingAccessRequests.length;
  const reviewQueries = [
    workflows,
    sources,
    integrations,
    ...(canManageWorkflows ? [plans, plannerVersions, blueprints] : []),
    ...(canManageMemory ? [memoryChanges] : []),
    ...(canViewOrganization ? [accessRequests] : []),
  ];
  const reviewUnavailable = reviewQueries.some((query) => query.isError);
  const reviewLoading = reviewQueries.some((query) => query.isLoading);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Activity"
        description="Technical activity that needs a decision or follow-up in the current scope. Each item links to the product surface that owns it. Data refreshes after reconnect or when you retry an unavailable request."
      />

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>
            Current activity summary. Open the linked surface for details.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ActivityMetric
            icon={ActivityIcon}
            label="Running"
            value={
              workflows.isError
                ? "—"
                : workflows.isLoading
                  ? "…"
                  : runningRuns.length
            }
            detail="Queued, running, or paused Runs"
            to="/workflows/runs"
          />
          <ActivityMetric
            icon={AlertTriangle}
            label="Run attention"
            value={
              workflows.isError
                ? "—"
                : workflows.isLoading
                  ? "…"
                  : failedRuns.length
            }
            detail="Failed or partial investigations"
            to="/workflows/runs"
          />
          <ActivityMetric
            icon={Waypoints}
            label="Sources & Integrations"
            value={environmentAttention}
            detail="Source health and connector setup"
            to="/organization/sources"
            secondaryLinks={[
              { label: "Integrations", to: "/organization/integrations" },
            ]}
          />
          <ActivityMetric
            icon={ClipboardCheck}
            label="Approvals & changes"
            value={decisionAttention}
            detail="Runs, Plans, memory, and access"
            to="/workflows/runs"
            secondaryLinks={[
              { label: "Plans", to: "/workflows/plans" },
              { label: "Workflows", to: "/workflows" },
              { label: "Access", to: "/management/access" },
            ]}
          />
        </CardContent>
      </Card>

      {reviewUnavailable ? (
        <InlineError
          title="Activity unavailable"
          message="Some operational data could not be loaded, so Activity is not marked clear."
          onRetry={() =>
            Promise.all(reviewQueries.map((query) => query.refetch()))
          }
          retrying={reviewQueries.some((query) => query.isFetching)}
        />
      ) : null}
      {!reviewUnavailable && !reviewLoading && attentionCount === 0 ? (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="flex items-start gap-3 p-5">
            <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" />
            <div>
              <p className="font-medium">Nothing needs attention</p>
              <p className="mt-1 text-sm text-muted-foreground">
                No waiting approvals, failing runs, unhealthy Sources, or
                incomplete Integrations are visible in this scope.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <ReviewCard
          title="Run attention"
          description="Investigations that ended partially or failed."
          icon={GitBranch}
          to="/workflows/runs"
          loading={workflows.isLoading}
          error={workflows.error}
          empty="No failed or partial workflow runs."
          hasItems={failedRuns.length > 0}
        >
          {failedRuns.map((workflow) => (
            <WorkflowReviewRow key={workflow.workflowId} workflow={workflow} />
          ))}
        </ReviewCard>
        <ReviewCard
          title="Sources & Integrations"
          description="Provider health and Source availability in the current scope."
          icon={Waypoints}
          loading={sources.isLoading || integrations.isLoading}
          error={sources.error ?? integrations.error}
          empty="All visible Sources are healthy and Integrations are active or intentionally disabled."
          hasItems={
            unhealthySources.length > 0 || pendingIntegrations.length > 0
          }
        >
          <ReviewSection
            title="Source attention"
            to="/organization/sources"
            empty="All visible Sources are healthy."
          >
            {unhealthySources.map((source) => (
              <SourceReviewRow key={source.id} source={source} />
            ))}
          </ReviewSection>
          <ReviewSection
            title="Integration setup"
            to="/organization/integrations"
          >
            {pendingIntegrations.map((integration) => (
              <IntegrationReviewRow
                key={integration.id}
                integration={integration}
              />
            ))}
          </ReviewSection>
        </ReviewCard>
        <ReviewCard
          title="Approvals & changes"
          description="All decisions and scoped changes that may need an authorized action."
          icon={ClipboardCheck}
          loading={[workflows, plans, memoryChanges, accessRequests].some(
            (query) => query.isLoading,
          )}
          error={
            workflows.error ??
            plans.error ??
            memoryChanges.error ??
            accessRequests.error
          }
          empty="No approval or scoped change is waiting for review."
          hasItems={
            waitingRuns.length > 0 ||
            pendingPlans.length > 0 ||
            pendingMemoryChanges.length > 0 ||
            pendingAccessRequests.length > 0
          }
        >
          <ReviewSection
            title="Waiting approvals"
            to="/workflows/runs"
            empty="No workflow run is waiting for approval."
          >
            {waitingRuns.map((workflow) => (
              <WorkflowReviewRow
                key={workflow.workflowId}
                workflow={workflow}
              />
            ))}
          </ReviewSection>
          <ReviewSection
            title="Workflow Plans"
            to="/workflows/plans"
            empty="No workflow Plan is waiting for approval or apply."
          >
            {planActionError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                Could not update the workflow Plan: {planActionError}
              </p>
            ) : null}
            {pendingPlans.map((plan) => (
              <WorkflowPlanReviewRow
                key={plan.planId}
                plan={plan}
                blueprints={blueprints.data ?? []}
                busy={approvePlan.isPending || applyPlan.isPending}
                onApprove={(planId) => {
                  setPlanActionError(null);
                  approvePlan.mutate(planId);
                }}
                onApply={(planId) => {
                  setPlanActionError(null);
                  applyPlan.mutate(planId);
                }}
              />
            ))}
          </ReviewSection>
          {canManageMemory ? (
            <ReviewSection
              title="Memory changes"
              to="/workflows/memory"
              empty="No memory change is waiting for review."
            >
              {memoryActionError ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  Could not update the memory change: {memoryActionError}
                </p>
              ) : null}
              {pendingMemoryChanges.map((change) => (
                <MemoryChangeReviewRow
                  key={change.id}
                  change={change}
                  busy={
                    approveMemoryChangeMutation.isPending ||
                    rejectMemoryChangeMutation.isPending ||
                    applyMemoryChangeMutation.isPending
                  }
                  onApprove={(id) => approveMemoryChangeMutation.mutate(id)}
                  onReject={(id) => rejectMemoryChangeMutation.mutate(id)}
                  onApply={(id) => applyMemoryChangeMutation.mutate(id)}
                />
              ))}
            </ReviewSection>
          ) : null}
          {canViewOrganization ? (
            <ReviewSection
              title="Access requests"
              to="/management/access"
              empty="No access request is waiting for review."
            >
              {accessRequestActionError ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  Could not update the access request:{" "}
                  {accessRequestActionError}
                </p>
              ) : null}
              {pendingAccessRequests.map((request) => (
                <AccessRequestReviewRow
                  key={request.id}
                  request={request}
                  canDecide={Boolean(
                    isOrganizationAdministrator &&
                      request.requestedByUserId !== currentMember?.id,
                  )}
                  isOwn={request.requestedByUserId === currentMember?.id}
                  busy={accessRequestMutation.isPending}
                  onAction={(action) => {
                    setAccessRequestActionError(null);
                    accessRequestMutation.mutate({ id: request.id, action });
                  }}
                />
              ))}
            </ReviewSection>
          ) : null}
        </ReviewCard>
        {canManageWorkflows ? (
          <ReviewCard
            title="Planner history"
            description="Persisted planner, source-schema, and prompt fingerprints used by workflow plans. Raw prompt text is never shown."
            icon={ClipboardCheck}
            to="/workflows"
            loading={plannerVersions.isLoading}
            error={plannerVersions.error}
            empty="No planner version has been observed yet."
            hasItems={Boolean(plannerVersions.data?.length)}
          >
            {(plannerVersions.data ?? []).map((version) => (
              <PlannerVersionReviewRow key={version.id} version={version} />
            ))}
          </ReviewCard>
        ) : null}
      </div>
    </div>
  );
}

type ActivityRoute =
  | "/workflows"
  | "/workflows/runs"
  | "/workflows/plans"
  | "/workflows/memory"
  | "/organization/sources"
  | "/organization/integrations"
  | "/management/access";

function ActivityMetric({
  icon: Icon,
  label,
  value,
  detail,
  to,
  secondaryLinks,
}: {
  icon: typeof Clock3;
  label: string;
  value: number | string;
  detail: string;
  to: ActivityRoute;
  secondaryLinks?: readonly { label: string; to: ActivityRoute }[];
}) {
  return (
    <div className="min-w-0 border-l pl-4 first:border-l-0 first:pl-0">
      <Link
        to={to}
        className="group flex items-center gap-2 text-sm font-medium hover:text-foreground"
      >
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        {label}
        <ArrowUpRight
          className="size-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Link>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      {secondaryLinks?.length ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {secondaryLinks.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="inline-flex text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {item.label}
              <ArrowUpRight className="ml-1 size-3" aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function aggregateMetric(
  queries: readonly { isLoading: boolean; isError: boolean }[],
  values: readonly number[],
): number | string {
  if (queries.some((query) => query.isError)) return "—";
  if (queries.some((query) => query.isLoading)) return "…";
  return values.reduce((total, value) => total + value, 0);
}

function ReviewCard({
  title,
  description,
  icon: Icon,
  loading,
  error,
  empty,
  hasItems,
  children,
  to,
}: {
  title: string;
  description: string;
  icon: typeof Clock3;
  loading: boolean;
  error: Error | null;
  empty?: string;
  hasItems: boolean;
  children: React.ReactNode;
  to?:
    | "/workflows/runs"
    | "/organization/sources"
    | "/organization/integrations"
    | "/workflows"
    | "/workflows/plans"
    | "/workflows/memory"
    | "/management/access";
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex min-w-0 items-center gap-2">
              <Icon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {to ? (
            <Link
              to={to}
              aria-label={`Open all ${title}`}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">
            Loading activity items…
          </p>
        ) : error ? (
          <p className="text-sm text-destructive">
            Could not load this activity: {error.message}
          </p>
        ) : hasItems ? (
          children
        ) : (
          <EmptyPanel
            icon={CircleDashed}
            title="Nothing here"
            description={empty}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ReviewSection({
  title,
  to,
  empty,
  children,
}: {
  title: string;
  to: ActivityRoute;
  empty: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);
  return (
    <section className="flex flex-col gap-2 border-b pb-3 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <Link
          to={to}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open <ArrowUpRight className="inline size-3" aria-hidden="true" />
        </Link>
      </div>
      {hasChildren ? (
        children
      ) : empty ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : null}
    </section>
  );
}

function WorkflowReviewRow({
  workflow,
}: {
  workflow: WorkflowExecutionProjection;
}) {
  return (
    <Link
      to="/workflows/$workflowId"
      params={{ workflowId: workflow.workflowId }}
      className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <GitBranch
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {workflowLabel(workflow.blueprintId, workflow.workflowType)}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {workflow.statusMessage ??
            workflowStatusLabel(workflow.status, workflow.statusReason)}{" "}
          · {formatDate(workflow.updatedAt)}
        </span>
      </span>
      <WorkflowStatusIndicator
        status={workflow.status}
        reason={workflow.statusReason}
        compact
      />
    </Link>
  );
}

function SourceReviewRow({ source }: { source: KnowledgeSource }) {
  return (
    <Link
      to="/organization/sources/$sourceId"
      params={{ sourceId: source.id }}
      className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Waypoints
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {source.name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {source.provider ?? source.kind} · {source.status.replace("_", " ")}
        </span>
      </span>
      <RefreshCw
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </Link>
  );
}

function IntegrationReviewRow({
  integration,
}: {
  integration: IntegrationProjection;
}) {
  return (
    <Link
      to="/organization/integrations/$integrationId"
      params={{ integrationId: integration.id }}
      className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <PlugZap className="size-4 text-muted-foreground" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {integration.name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {integration.provider} ·{" "}
          {integration.status === IntegrationStatus.Error
            ? "connection error"
            : integration.status === IntegrationStatus.NeedsReauth
              ? "reauthorization required"
              : integration.status === IntegrationStatus.Degraded
                ? "provider degraded"
                : integration.status === IntegrationStatus.Authorized
                  ? "ready to enable"
                  : "authorization pending"}
        </span>
      </span>
      <AlertTriangle
        className="size-4 shrink-0 text-amber-600"
        aria-hidden="true"
      />
    </Link>
  );
}

function WorkflowPlanReviewRow({
  plan,
  blueprints,
  busy,
  onApprove,
  onApply,
}: {
  plan: WorkflowPlanRecord;
  blueprints: readonly WorkflowBlueprintProjection[];
  busy: boolean;
  onApprove: (planId: string) => void;
  onApply: (planId: string) => void;
}) {
  const change = plan.plan.changes[0];
  const label =
    change?.blueprint?.name ?? change?.reason ?? "Workflow change proposal";
  const detail = `${change?.kind ?? "change"} · ${plan.status === "proposed" ? "awaiting approval" : "ready to apply"} · ${formatDate(plan.updatedAt)}`;
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <ClipboardCheck
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {detail}
        </span>
        <PlanDiff plan={plan} blueprints={blueprints} />
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Technical details</summary>
          <code className="mt-1 block break-all">{plan.planId}</code>
        </details>
      </span>
      <span className="flex shrink-0 gap-2">
        {plan.status === "proposed" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onApprove(plan.planId)}
          >
            Approve
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => onApply(plan.planId)}
          >
            Apply
          </Button>
        )}
      </span>
    </div>
  );
}

function PlannerVersionReviewRow({
  version,
}: {
  version: WorkflowPlannerVersionProjection;
}) {
  const planner =
    [version.plannerName, version.plannerVersion].filter(Boolean).join("@") ||
    "Planner metadata unavailable";
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <ClipboardCheck
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{planner}</span>
          <span className="block text-xs text-muted-foreground">
            {version.usageCount} plan{version.usageCount === 1 ? "" : "s"} ·
            last observed {formatDate(version.lastSeenAt)}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <DescriptionPill>
          Schema {version.sourceSchemaVersion ?? "Not reported"}
        </DescriptionPill>
        {version.promptVersion ? (
          <DescriptionPill>Prompt {version.promptVersion}</DescriptionPill>
        ) : null}
        <DescriptionPill>
          Fingerprint {version.versionHash.slice(0, 12)}
        </DescriptionPill>
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Version history details</summary>
        <div className="mt-2 flex flex-col gap-1">
          <span>First observed: {formatDate(version.firstSeenAt)}</span>
          <span>First plan: {version.firstPlanId}</span>
          <span>Latest plan: {version.lastPlanId}</span>
          {version.promptHash ? (
            <span>Prompt hash: {version.promptHash}</span>
          ) : (
            <span>Prompt hash: Not reported</span>
          )}
        </div>
      </details>
    </div>
  );
}

function MemoryChangeReviewRow({
  change,
  busy,
  onApprove,
  onReject,
  onApply,
}: {
  change: MemoryChangeRecord;
  busy: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onApply: (id: string) => void;
}) {
  const label =
    change.action === "add"
      ? "Addition"
      : change.action === "correct"
        ? "Correction"
        : "Deletion";
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <BrainCircuit
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          {label} · {change.agentDefinition}
        </span>
        <span className="block text-xs text-muted-foreground">
          {change.status} · {formatDate(change.updatedAt)} · Scope{" "}
          {change.scope.ids.length}
        </span>
        {change.action === "add" || change.action === "correct" ? (
          <p className="mt-2 rounded-md bg-muted/30 p-2 text-xs leading-5">
            {change.replacementSummary}
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            The provider memory will be deleted after approval and runtime
            confirmation.
          </p>
        )}
        {change.evidenceRefs?.length ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Evidence references: {change.evidenceRefs.length}
          </p>
        ) : null}
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Technical details</summary>
          <code className="mt-1 block break-all">
            Request {change.id}
            {change.memoryId ? (
              <>
                <br />
                Memory {change.memoryId}
              </>
            ) : null}
          </code>
        </details>
      </span>
      <span className="flex shrink-0 flex-wrap gap-2">
        {change.status === "proposed" ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onReject(change.id)}
            >
              Reject
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onApprove(change.id)}
            >
              Approve
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => onApply(change.id)}>
            Apply
          </Button>
        )}
      </span>
    </div>
  );
}

function AccessRequestReviewRow({
  request,
  canDecide,
  isOwn,
  busy,
  onAction,
}: {
  request: OrganizationAccessRequestRecord;
  canDecide: boolean;
  isOwn: boolean;
  busy: boolean;
  onAction: (action: "approve" | "reject" | "apply") => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <UserRound
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          {request.requesterName} · {request.unitName} · {request.access}
        </span>
        <span className="block text-xs text-muted-foreground">
          {request.status} · {request.reason} · {formatDate(request.updatedAt)}
        </span>
      </span>
      {canDecide && request.status === "proposed" ? (
        <span className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onAction("reject")}
          >
            Reject
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onAction("approve")}>
            Approve
          </Button>
        </span>
      ) : null}
      {canDecide && request.status === "approved" ? (
        <Button size="sm" disabled={busy} onClick={() => onAction("apply")}>
          Apply scope
        </Button>
      ) : null}
      {isOwn && request.status === "proposed" ? (
        <span className="text-xs text-muted-foreground">
          Awaiting another administrator
        </span>
      ) : null}
    </div>
  );
}

function PlanDiff({
  plan,
  blueprints,
}: {
  plan: WorkflowPlanRecord;
  blueprints: readonly WorkflowBlueprintProjection[];
}) {
  const change = plan.plan.changes.find((candidate) => candidate.blueprint);
  const target = change?.blueprint;
  if (!target)
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        No Blueprint snapshot in this plan; review the target workflow command
        before applying.
      </p>
    );
  const baseline = blueprints
    .filter(
      (blueprint) =>
        blueprint.blueprintId === target.blueprintId &&
        blueprint.version !== target.version,
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const beforeById = new Map(
    (baseline?.steps ?? []).map((step) => [step.id, step]),
  );
  const afterById = new Map(target.steps.map((step) => [step.id, step]));
  const changedSteps = [
    ...new Set([...beforeById.keys(), ...afterById.keys()]),
  ].flatMap(
    (
      stepId,
    ): Array<{ kind: "added" | "removed" | "changed"; step: WorkflowStep }> => {
      const before = beforeById.get(stepId);
      const after = afterById.get(stepId);
      if (!before && after) return [{ kind: "added" as const, step: after }];
      if (before && !after) return [{ kind: "removed" as const, step: before }];
      if (before && after && JSON.stringify(before) !== JSON.stringify(after))
        return [{ kind: "changed" as const, step: after }];
      return [];
    },
  );
  return (
    <details className="mt-2 rounded-md border bg-muted/20 px-2.5 py-2 text-xs">
      <summary className="cursor-pointer font-medium">
        Review Blueprint diff · v{target.version}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          <DescriptionPill>
            {baseline
              ? `Compared with v${baseline.version}`
              : "New Blueprint revision"}
          </DescriptionPill>
          <DescriptionPill>{target.steps.length} steps</DescriptionPill>
          {plan.plan.metadata?.planner ? (
            <DescriptionPill>
              Planner {plan.plan.metadata.planner.name}@
              {plan.plan.metadata.planner.version}
            </DescriptionPill>
          ) : null}
          {plan.plan.metadata?.sourceSchemaVersion ? (
            <DescriptionPill>
              Schema {plan.plan.metadata.sourceSchemaVersion}
            </DescriptionPill>
          ) : null}
          {plan.plan.metadata?.promptHash ? (
            <DescriptionPill>Prompt hash recorded</DescriptionPill>
          ) : null}
        </div>
        {changedSteps.length ? (
          <div className="flex flex-col gap-1">
            {changedSteps.map((item) => (
              <div
                key={`${item.kind}:${item.step.id}`}
                className="flex items-center gap-2"
              >
                <span
                  className={
                    item.kind === "added"
                      ? "text-emerald-700"
                      : item.kind === "removed"
                        ? "text-destructive"
                        : "text-amber-700"
                  }
                >
                  {item.kind}
                </span>
                <span className="font-medium">{item.step.id}</span>
                <span className="text-muted-foreground">
                  {stepSummary(item.step)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">
            No step-level changes from the available baseline.
          </p>
        )}
        {!baseline ? (
          <p className="text-muted-foreground">
            No previous approved revision is available for this Blueprint ID, so
            this plan is treated as a new definition.
          </p>
        ) : null}
      </div>
    </details>
  );
}

function stepSummary(step: WorkflowStep): string {
  if (step.kind === "tool") return `tool · ${step.tool ?? "not specified"}`;
  if (step.kind === "agent")
    return `agent · ${step.agentDefinition ?? "not specified"}`;
  return step.kind;
}
