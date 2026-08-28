import {
  type IntegrationProjection,
  IntegrationStatus,
  Permission,
} from "@encois/contracts/browser";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Github, PlugZap, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { CurrentScopePill, CurrentScopeText } from "@/components/current-scope";
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
import { ProductTerm } from "@/components/product-term";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listIntegrationsPage } from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { humanizeKey } from "@/lib/formatters";
import { useOrganization } from "@/lib/organization-context";
import { useCan } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/organization/integrations/")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.IntegrationsRead))
      throw redirect({ to: "/forbidden" });
  },
  component: IntegrationsPage,
});

const pageSize = 10;

function IntegrationsPage() {
  const navigate = Route.useNavigate();
  const { q } = Route.useSearch();
  const { units, currentUnitId, members } = useOrganization();
  const selectedScopeUnitId = units.some((unit) => unit.id === currentUnitId)
    ? currentUnitId
    : undefined;
  const currentUnit = units.find((unit) => unit.id === selectedScopeUnitId);
  const actor = members.find(
    (member) => member.id === getAuthSession()?.userId,
  );
  const canManage =
    useCan(Permission.IntegrationsManage) &&
    (actor?.roleKey === "organization_admin" || actor?.roleKey === "admin");
  const [status, setStatus] = useState<IntegrationStatus | "all">("all");
  const [sort, setSort] = useState<
    "updated-desc" | "updated-asc" | "name-asc" | "status"
  >("updated-desc");
  const [view, setView] = useState<ListViewMode>("grid");
  const integrations = useInfiniteQuery({
    queryKey: queryKeys.integrationPages(
      selectedScopeUnitId,
      q ?? "",
      status,
      sort,
    ),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listIntegrationsPage({
        scopeUnitId: selectedScopeUnitId,
        query: q,
        status,
        sort,
        limit: pageSize,
        offset: pageParam,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.offset + lastPage.pagination.limit
        : undefined,
  });
  const items = useMemo(
    () => integrations.data?.pages.flatMap((page) => page.items) ?? [],
    [integrations.data],
  );
  const firstIntegrationPage = integrations.data?.pages[0];
  const total = firstIntegrationPage?.pagination.total ?? 0;
  const statuses = [
    { value: "all", label: "All statuses" },
    ...Object.values(IntegrationStatus).map((value) => ({
      value,
      label: humanizeKey(value),
    })),
  ];
  const sorts = [
    { value: "updated-desc", label: "Recently updated" },
    { value: "updated-asc", label: "Oldest updated" },
    { value: "name-asc", label: "Name" },
    { value: "status", label: "Status" },
  ] as const;
  function updateQuery(value: string) {
    void navigate({
      replace: true,
      resetScroll: false,
      search: { q: value || undefined },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={<ProductTerm term="integration" plural />}
        description={
          <>
            Organization-level provider integrations are available to authorized
            unit-scoped Sources.
          </>
        }
        actions={
          canManage ? (
            <Button asChild>
              <Link
                to="/organization/integrations/new"
                search={{ provider: undefined, type: undefined }}
              >
                <Plus data-icon="inline-start" />
                Add integration
              </Link>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Read-only access
            </span>
          )
        }
      />
      <ListToolbar>
        <ListSearch
          value={q ?? ""}
          onChange={updateQuery}
          placeholder="Search Integrations by provider or name…"
          label="Search Integrations"
        />
        <ListFilter
          value={status}
          onChange={(value) => setStatus(value as IntegrationStatus | "all")}
          options={statuses}
          label="Filter Integrations by status"
        />
        <ListSort
          value={sort}
          onChange={(value) => setSort(value as typeof sort)}
          options={sorts}
          label="Sort Integrations"
        />
      </ListToolbar>
      <ListResultsHeader
        count={items.length}
        total={total}
        label="visible integrations"
        view={view}
        onViewChange={setView}
      />
      {integrations.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading Integrations…</p>
      ) : null}
      {integrations.isError ? (
        <InlineError
          title="Integrations unavailable"
          message={integrations.error.message}
          onRetry={() => integrations.refetch()}
          retrying={integrations.isFetching}
        />
      ) : null}
      {!integrations.isLoading && !integrations.isError && items.length ? (
        <ListCollection
          items={items}
          view={view}
          getKey={(integration) => integration.id}
          renderItem={(integration) => (
            <IntegrationPreviewCard integration={integration} view={view} />
          )}
        />
      ) : null}
      {!integrations.isLoading && !integrations.isError && !items.length ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={q || status !== "all" ? Search : PlugZap}
              title={
                q || status !== "all" ? (
                  "No Integrations match"
                ) : (
                  <>
                    No Integrations in <CurrentScopeText />
                    {currentUnit?.type === "organization" ? "" : " scope"}
                  </>
                )
              }
              description={
                q || status !== "all" ? (
                  "Change the search or status filter."
                ) : (
                  <>
                    No connected Integrations are available in{" "}
                    <CurrentScopeText />
                    {currentUnit?.type === "organization" ? "" : " scope"}.
                  </>
                )
              }
            />
          </CardContent>
        </Card>
      ) : null}
      {!integrations.isLoading && !integrations.isError && items.length ? (
        <ListPagination
          hasMore={Boolean(integrations.hasNextPage)}
          loading={integrations.isFetchingNextPage}
          onLoadMore={() => void integrations.fetchNextPage()}
        />
      ) : null}
    </div>
  );
}

function IntegrationPreviewCard({
  integration,
  view,
}: {
  integration: IntegrationProjection;
  view: ListViewMode;
}) {
  const Icon =
    integration.provider.toLowerCase() === "github" ? Github : PlugZap;
  return (
    <Link
      to="/organization/integrations/$integrationId"
      params={{ integrationId: integration.id }}
      className="group block"
    >
      <Card
        className={
          view === "list"
            ? "relative transition-colors group-hover:border-foreground/30 md:flex-row md:items-center md:justify-between"
            : "relative h-full transition-colors group-hover:border-foreground/30"
        }
      >
        <CardHeader className="flex min-w-0 flex-1 flex-row flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 items-center justify-center rounded-md border bg-muted/30">
              <Icon
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0 flex flex-col gap-1.5">
              <CardTitle className="truncate">{integration.name}</CardTitle>
              <CardDescription>
                {integration.provider} · {integration.type.toUpperCase()}
              </CardDescription>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <CurrentScopePill />
            <StatusPill
              status={integration.status}
              label={humanizeKey(integration.status)}
            />
          </div>
        </CardHeader>
        <CardContent
          className={
            view === "list"
              ? "flex flex-wrap items-center justify-end gap-2 pr-14 text-xs text-muted-foreground md:shrink-0"
              : "flex flex-wrap items-center gap-2 pr-14 text-xs text-muted-foreground"
          }
        >
          <span>{integration.provider} integration</span>
        </CardContent>
        <LinkCardIndicator />
      </Card>
    </Link>
  );
}
