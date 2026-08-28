import {
  type IntegrationCatalogProjection,
  IntegrationCatalogStatus,
  type IntegrationProjection,
  IntegrationType,
  Permission,
} from "@encois/contracts/browser";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Bot, Github, PlugZap, Plus, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { unavailableCardClassName } from "@/components/availability-state";
import { EmptyPanel } from "@/components/empty-panel";
import { InlineError } from "@/components/inline-error";
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
import { DescriptionPill, StatusPill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listIntegrationCatalogPage, listIntegrations } from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { humanizeKey } from "@/lib/formatters";
import { useOrganization } from "@/lib/organization-context";
import { useCan } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/organization/integrations/catalog")(
  {
    validateSearch: (search: Record<string, unknown>) => ({
      q: typeof search.q === "string" ? search.q : undefined,
      type: Object.values(IntegrationType).includes(
        search.type as IntegrationType,
      )
        ? (search.type as IntegrationType)
        : ("all" as const),
    }),
    beforeLoad: () => {
      if (!hasPermission(getAuthSession(), Permission.IntegrationsRead))
        throw redirect({ to: "/forbidden" });
    },
    component: IntegrationCatalogPage,
  },
);

const pageSize = 10;

function IntegrationCatalogPage() {
  const navigate = Route.useNavigate();
  const { q, type: catalogType } = Route.useSearch();
  const { currentUnitId, units, members } = useOrganization();
  const actor = members.find(
    (member) => member.id === getAuthSession()?.userId,
  );
  const canManage =
    useCan(Permission.IntegrationsManage) &&
    (actor?.roleKey === "organization_admin" || actor?.roleKey === "admin");
  const selectedScopeUnitId = units.some((unit) => unit.id === currentUnitId)
    ? currentUnitId
    : undefined;
  const [status, setStatus] = useState<IntegrationCatalogStatus | "all">("all");
  const [sort, setSort] = useState<
    "updated-desc" | "updated-asc" | "name-asc" | "status"
  >("status");
  const [view, setView] = useState<ListViewMode>("grid");
  const integrations = useQuery({
    queryKey: queryKeys.integrations(selectedScopeUnitId),
    queryFn: () => listIntegrations({ scopeUnitId: selectedScopeUnitId }),
  });
  const catalog = useInfiniteQuery({
    queryKey: queryKeys.integrationCatalog(catalogType, q ?? "", status, sort),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listIntegrationCatalogPage({
        type: catalogType === "all" ? undefined : catalogType,
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
    () => catalog.data?.pages.flatMap((page) => page.items) ?? [],
    [catalog.data],
  );
  const total = catalog.data?.pages[0]?.pagination.total ?? 0;
  const registeredIntegrations = integrations.data ?? [];
  const statuses = [
    { value: "all", label: "All statuses" },
    ...Object.values(IntegrationCatalogStatus).map((value) => ({
      value,
      label: humanizeKey(value),
    })),
  ];
  const sorts = [
    { value: "status", label: "Status" },
    { value: "name-asc", label: "Name" },
    { value: "updated-desc", label: "Recently updated" },
    { value: "updated-asc", label: "Oldest updated" },
  ] as const;

  function updateSearch(value: string) {
    void navigate({
      replace: true,
      resetScroll: false,
      search: { q: value || undefined, type: catalogType },
    });
  }

  function updateType(nextType: IntegrationType | "all") {
    void navigate({
      replace: true,
      resetScroll: false,
      search: { q, type: nextType },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Integration Catalog"
        description="Browse provider connectors available to this organization. Register an Integration first, then configure unit-specific Sources."
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
          ) : null
        }
      />
      <ListToolbar>
        <ListSearch
          value={q ?? ""}
          onChange={updateSearch}
          placeholder="Search the Integration Catalog…"
          label="Search Integration Catalog"
        />
        <ListFilter
          value={catalogType}
          onChange={(value) => updateType(value as IntegrationType | "all")}
          options={[
            { value: "all", label: "All" },
            { value: IntegrationType.Ai, label: "AI" },
            { value: IntegrationType.Api, label: "API" },
            { value: IntegrationType.Mcp, label: "MCP" },
          ]}
          label="Filter Integration Catalog by type"
        />
        <ListFilter
          value={status}
          onChange={(value) =>
            setStatus(value as IntegrationCatalogStatus | "all")
          }
          options={statuses}
          label="Filter Integration Catalog by status"
        />
        <ListSort
          value={sort}
          onChange={(value) => setSort(value as typeof sort)}
          options={sorts}
          label="Sort Integration Catalog"
        />
      </ListToolbar>
      <ListResultsHeader
        count={items.length}
        total={total}
        label="visible connectors"
        view={view}
        onViewChange={setView}
      />
      {integrations.isError ? (
        <InlineError
          title="Registered Integrations unavailable"
          message={integrations.error.message}
          onRetry={() => integrations.refetch()}
          retrying={integrations.isFetching}
        />
      ) : null}
      {catalog.isLoading ? (
        <p className="text-sm text-muted-foreground">
          Loading Integration Catalog…
        </p>
      ) : null}
      {catalog.isError ? (
        <InlineError
          title="Integration Catalog unavailable"
          message={catalog.error.message}
          onRetry={() => catalog.refetch()}
          retrying={catalog.isFetching}
        />
      ) : null}
      {!catalog.isLoading && !catalog.isError && items.length ? (
        <ListCollection
          items={items}
          view={view}
          getKey={(entry) => entry.key}
          renderItem={(entry) => (
            <IntegrationCatalogCard
              entry={entry}
              integrations={registeredIntegrations}
              canManage={canManage}
            />
          )}
        />
      ) : null}
      {!catalog.isLoading && !catalog.isError && !items.length ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={Search}
              title="No integrations match"
              description="Change the search, connector type, or status filter."
            />
          </CardContent>
        </Card>
      ) : null}
      {!catalog.isLoading && !catalog.isError && items.length ? (
        <ListPagination
          hasMore={Boolean(catalog.hasNextPage)}
          loading={catalog.isFetchingNextPage}
          onLoadMore={() => void catalog.fetchNextPage()}
        />
      ) : null}
    </div>
  );
}

function IntegrationCatalogCard({
  entry,
  integrations,
  canManage,
}: {
  entry: IntegrationCatalogProjection;
  integrations: readonly IntegrationProjection[];
  canManage: boolean;
}) {
  const Icon =
    entry.type === IntegrationType.Ai
      ? Sparkles
      : entry.type === IntegrationType.Mcp
        ? Bot
        : entry.provider === "github"
          ? Github
          : PlugZap;
  const registered = integrations.filter(
    (integration) =>
      integration.provider.toLowerCase() === entry.provider &&
      integration.type === entry.type,
  ).length;
  const available = entry.status === IntegrationCatalogStatus.Active;
  const statusLabel =
    entry.status === IntegrationCatalogStatus.Disabled
      ? "Coming soon"
      : entry.status === IntegrationCatalogStatus.Pending
        ? "Pending"
        : registered
          ? `${registered} registered`
          : "Available";

  return (
    <Card className={cn("h-full", !available && unavailableCardClassName)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-9 items-center justify-center rounded-md border bg-muted/30">
            <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          </span>
          <div>
            <CardTitle className="text-base">{entry.name}</CardTitle>
            <CardDescription>{entry.description}</CardDescription>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={entry.status} label={statusLabel} />
          {available && canManage ? (
            <Button variant="outline" size="sm" asChild>
              <Link
                to="/organization/integrations/new"
                search={{ provider: entry.provider, type: entry.type }}
              >
                Register
              </Link>
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
          <DescriptionPill>{entry.type.toUpperCase()}</DescriptionPill>
          {entry.capabilities.map((capability) => (
            <DescriptionPill key={capability}>{capability}</DescriptionPill>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
