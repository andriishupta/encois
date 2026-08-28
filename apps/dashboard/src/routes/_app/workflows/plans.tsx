import type { WorkflowPlanRecord } from "@encois/contracts/browser";
import { Permission } from "@encois/contracts/browser";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { ClipboardCheck, Search } from "lucide-react";
import { useState } from "react";
import { EmptyPanel } from "@/components/empty-panel";
import { InlineError } from "@/components/inline-error";
import { LinkCardIndicator } from "@/components/link-card";
import {
  ListCollection,
  ListFilter,
  ListPagination,
  ListResultsHeader,
  ListSearch,
  ListSort,
  ListToolbar,
  type ListViewMode,
} from "@/components/list-controls";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/pill";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listWorkflowPlansPage } from "@/lib/api";
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
  component: WorkflowPlansRoute,
});

type PlanFilter = WorkflowPlanRecord["status"] | "all";

function WorkflowPlansRoute() {
  const { pathname } = useLocation();
  return pathname === "/workflows/plans" ? <WorkflowPlansPage /> : <Outlet />;
}

function WorkflowPlansPage() {
  const { units } = useOrganization();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PlanFilter>("all");
  const [sort, setSort] = useState<
    "updated-desc" | "updated-asc" | "name-asc" | "status"
  >("updated-desc");
  const [view, setView] = useState<ListViewMode>("list");
  const plans = useInfiniteQuery({
    queryKey: queryKeys.workflowPlanPages(query, status, sort),
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
  });
  const visiblePlans = plans.data?.pages.flatMap((page) => page.items) ?? [];
  const total = plans.data?.pages[0]?.pagination.total;
  const pendingCount = visiblePlans.filter(
    (plan) => plan.status === "proposed" || plan.status === "approved",
  ).length;

  return (
    <div data-testid="workflow-plans-page" className="flex flex-col gap-4">
      <PageHeader
        title="Plans"
        description="Review persisted workflow change proposals, approve them, and apply approved changes to Workflows."
      />
      <ListToolbar>
        <ListSearch
          value={query}
          onChange={setQuery}
          placeholder="Search Plans by workflow name or purpose…"
          label="Search Plans"
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
        <ListSort
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
      </ListToolbar>
      <ListResultsHeader
        count={visiblePlans.length}
        total={total}
        label="visible plans"
        meta={`${pendingCount} pending`}
        view={view}
        onViewChange={setView}
      />
      {plans.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading Plans…</p>
      ) : null}
      {plans.isError ? (
        <InlineError
          title="Plans unavailable"
          message={plans.error.message}
          onRetry={() => plans.refetch()}
          retrying={plans.isFetching}
        />
      ) : null}
      {visiblePlans.length ? (
        <ListCollection
          items={visiblePlans}
          view={view}
          getKey={(plan) => plan.planId}
          renderItem={(plan) => <WorkflowPlanCard plan={plan} units={units} />}
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
              title="No Plans"
              description="Submitted workflow proposals will appear here until they are applied as Blueprints."
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
}: {
  plan: WorkflowPlanRecord;
  units: ReturnType<typeof useOrganization>["units"];
}) {
  const change = plan.plan.changes[0];
  const blueprint = change?.blueprint;
  const scope =
    plan.plan.scope?.ids
      ?.map((id) => formatUnitPath(units, id) || id)
      .join(", ") || "Organization scope";
  const status = planStatusLabel(plan.status);
  return (
    <Link
      to="/workflows/plans/$planId"
      params={{ planId: plan.planId }}
      className="group block h-full"
    >
      <Card
        data-testid="workflow-plan-card"
        className="relative flex h-full flex-col transition-colors group-hover:border-foreground/30"
      >
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle data-testid="workflow-plan-title">
                {blueprint?.name ?? "Plan proposal"}
              </CardTitle>
              <CardDescription>
                {change?.kind ?? "change"} · {status} ·{" "}
                {formatDate(plan.updatedAt)}
              </CardDescription>
            </div>
            <StatusPill
              data-testid="workflow-plan-status"
              status={plan.status}
              label={status}
              className="shrink-0"
            />
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4 pr-14">
          <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-3">
            <InfoItem label="Scope" value={scope} />
            <InfoItem
              label="Steps"
              value={String(blueprint?.steps?.length ?? 0)}
            />
            <InfoItem
              label="Approval"
              value={plan.approvalRequired ? "Required" : "Not required"}
            />
          </div>
          {blueprint ? (
            <p className="text-sm text-muted-foreground">{blueprint.purpose}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              This Plan does not contain a Blueprint snapshot.
            </p>
          )}
        </CardContent>
        <LinkCardIndicator />
      </Card>
    </Link>
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
