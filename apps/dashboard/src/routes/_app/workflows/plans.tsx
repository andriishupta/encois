import type { WorkflowPlanRecord } from "@encois/contracts";
import { Permission } from "@encois/contracts";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Check, ClipboardCheck, GitBranch, Search } from "lucide-react";
import { useState } from "react";
import { EmptyPanel } from "@/components/empty-panel";
import {
  ListCollection,
  ListFilter,
  ListMeta,
  ListPagination,
  ListSearch,
  ListToolbar,
  type ListViewMode,
  ListViewToggle,
} from "@/components/list-controls";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  applyWorkflowPlan,
  approveWorkflowPlan,
  listWorkflowPlansPage,
} from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { formatDate } from "@/lib/formatters";
import { formatUnitPath } from "@/lib/organization";
import { useOrganization } from "@/lib/organization-context";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/workflows/plans")({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.WorkflowsManage))
      throw redirect({ to: "/forbidden" });
  },
  component: WorkflowPlansPage,
});

type PlanFilter = WorkflowPlanRecord["status"] | "all";

function WorkflowPlansPage() {
  const queryClient = useQueryClient();
  const { units } = useOrganization();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PlanFilter>("all");
  const [sort, setSort] = useState<
    "updated-desc" | "updated-asc" | "name-asc" | "status"
  >("updated-desc");
  const [view, setView] = useState<ListViewMode>("list");
  const plans = useInfiniteQuery({
    queryKey: queryKeys.workflowPlans(query, status, sort),
    queryFn: ({ pageParam }) =>
      listWorkflowPlansPage({
        query,
        status,
        sort,
        limit: 10,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.offset + lastPage.pagination.limit
        : undefined,
    refetchInterval: 15_000,
  });
  const visiblePlans = plans.data?.pages.flatMap((page) => page.items) ?? [];
  const [actionError, setActionError] = useState<string | null>(null);
  const action = useMutation({
    mutationFn: async ({
      planId,
      operation,
    }: {
      planId: string;
      operation: "approve" | "apply";
    }) =>
      operation === "approve"
        ? approveWorkflowPlan(planId)
        : applyWorkflowPlan(planId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["workflow-plans"] }),
    onError: (error) => setActionError(error.message),
  });
  const pendingCount = visiblePlans.filter(
    (plan) => plan.status === "proposed" || plan.status === "approved",
  ).length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Workflow Plans"
        description="Approval boundary for workflow proposals. Review the generated Blueprint, approve it, then apply it to make it available in Workflows."
      />
      <ListToolbar>
        <ListSearch
          value={query}
          onChange={setQuery}
          placeholder="Search Plans by workflow name or purpose…"
          label="Search workflow Plans"
        />
        <ListFilter
          value={status}
          onChange={setStatus}
          label="Filter Plans by status"
          options={[
            { value: "all", label: "All statuses" },
            { value: "proposed", label: "Awaiting approval" },
            { value: "approved", label: "Ready to apply" },
            { value: "applied", label: "Applied" },
            { value: "rejected", label: "Rejected" },
            { value: "expired", label: "Expired" },
          ]}
        />
        <ListFilter
          value={sort}
          onChange={(value) => setSort(value as typeof sort)}
          label="Sort Plans"
          options={[
            { value: "updated-desc", label: "Recently updated" },
            { value: "updated-asc", label: "Oldest updated" },
            { value: "name-asc", label: "Name A–Z" },
            { value: "status", label: "Status" },
          ]}
        />
        <ListViewToggle value={view} onChange={setView} />
        <ListMeta>{pendingCount} pending Plans</ListMeta>
      </ListToolbar>
      {actionError ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6">
            <p role="alert" className="text-sm text-destructive">
              Could not update this Plan: {actionError}
            </p>
          </CardContent>
        </Card>
      ) : null}
      {plans.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading Plans…</p>
      ) : null}
      {plans.isError ? (
        <Card>
          <CardContent className="pt-6">
            <p role="alert" className="text-sm text-destructive">
              Could not load Plans: {plans.error.message}
            </p>
          </CardContent>
        </Card>
      ) : null}
      {visiblePlans.length ? (
        <ListCollection
          items={visiblePlans}
          view={view}
          getKey={(plan) => plan.planId}
          renderItem={(plan) => (
            <WorkflowPlanCard
              plan={plan}
              units={units}
              busy={action.isPending}
              onAction={(operation) => {
                setActionError(null);
                action.mutate({ planId: plan.planId, operation });
              }}
            />
          )}
        />
      ) : null}
      {!plans.isLoading &&
      !plans.isError &&
      plans.data &&
      !visiblePlans.length ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={Search}
              title="No Plans match"
              description="Change the search or status filter."
            />
          </CardContent>
        </Card>
      ) : null}
      {!plans.isLoading && !plans.isError && !plans.data ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={ClipboardCheck}
              title="No workflow Plans"
              description="Submitted workflow proposals will appear here before they become Blueprints."
            />
          </CardContent>
        </Card>
      ) : null}
      {!plans.isLoading && !plans.isError && visiblePlans.length ? (
        <ListPagination
          hasMore={Boolean(plans.hasNextPage)}
          loading={plans.isFetchingNextPage}
          onLoadMore={() => void plans.fetchNextPage()}
        />
      ) : null}
    </div>
  );
}

function WorkflowPlanCard({
  plan,
  units,
  busy,
  onAction,
}: {
  plan: WorkflowPlanRecord;
  units: ReturnType<typeof useOrganization>["units"];
  busy: boolean;
  onAction: (operation: "approve" | "apply") => void;
}) {
  const change = plan.plan.changes[0];
  const blueprint = change?.blueprint;
  const scope =
    plan.plan.scope?.ids
      ?.map((id) => formatUnitPath(units, id) || id)
      .join(", ") || "Organization scope";
  const status = planStatusLabel(plan.status);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle>
              {blueprint?.name ?? "Workflow change proposal"}
            </CardTitle>
            <CardDescription>
              {change?.kind ?? "change"} · {status} ·{" "}
              {formatDate(plan.updatedAt)}
            </CardDescription>
          </div>
          <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">
            {status}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-3">
          <InfoItem label="Scope" value={scope} />
          <InfoItem
            label="Steps"
            value={String(blueprint?.steps.length ?? 0)}
          />
          <InfoItem
            label="Approval"
            value={plan.approvalRequired ? "Required" : "Not required"}
          />
        </div>
        {blueprint ? (
          <details className="rounded-lg border p-4">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <GitBranch
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              Open proposed Blueprint
            </summary>
            <div className="mt-4 flex flex-col gap-3">
              <div>
                <p className="text-sm font-medium">{blueprint.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {blueprint.purpose}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {blueprint.steps.map((step, index) => (
                  <div
                    key={step.id}
                    className="flex items-center gap-3 rounded-md border p-3 text-sm"
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{step.id}</span>
                      <span className="block text-xs text-muted-foreground">
                        {step.kind}
                        {step.tool ? ` · ${step.tool}` : ""}
                        {step.agentDefinition
                          ? ` · ${step.agentDefinition}`
                          : ""}
                      </span>
                    </span>
                    {step.requiresApproval ? (
                      <span className="text-xs text-muted-foreground">
                        Approval
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
              {change?.reason ? (
                <p className="text-sm text-muted-foreground">
                  Reason: {change.reason}
                </p>
              ) : null}
            </div>
          </details>
        ) : (
          <p className="text-sm text-muted-foreground">
            This Plan does not contain a Blueprint snapshot.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="text-xs text-muted-foreground">
            Plan ID: <span className="font-mono">{plan.planId}</span>
          </div>
          <div className="flex gap-2">
            {plan.status === "proposed" ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => onAction("approve")}
              >
                <Check data-icon="inline-start" />
                Approve
              </Button>
            ) : null}
            {plan.status === "approved" ? (
              <Button disabled={busy} onClick={() => onAction("apply")}>
                Apply plan
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-medium">{value}</p>
    </div>
  );
}

function planStatusLabel(status: WorkflowPlanRecord["status"]): string {
  if (status === "proposed") return "Awaiting approval";
  if (status === "approved") return "Ready to apply";
  if (status === "applied") return "Applied";
  if (status === "rejected") return "Rejected";
  return "Expired";
}
