import {
  type IntegrationCatalogProjection,
  IntegrationCatalogStatus,
  type IntegrationProjection,
  IntegrationType,
  Permission,
} from "@encois/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { Bot, Github, PlugZap, Plus, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyPanel } from "@/components/empty-panel";
import { InlineError } from "@/components/inline-error";
import {
  ListCollection,
  ListFilter,
  ListPagination,
  ListResultsHeader,
  ListSearch,
  ListToolbar,
  type ListViewMode,
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
import { listIntegrationCatalogPage, listIntegrations } from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { humanizeKey } from "@/lib/formatters";
import { useOrganization } from "@/lib/organization-context";
import { useCan } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/organization/integrations/catalog")(
  {
    validateSearch: (search: Record<string, unknown>) => ({
      q: typeof search.q === "string" ? search.q : undefined,
      channel: search.channel === "ai" ? ("ai" as const) : ("api" as const),
      catalogType: Object.values(IntegrationType).includes(
        search.catalogType as IntegrationType,
      )
        ? (search.catalogType as IntegrationType)
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
  const navigate = useNavigate();
  const { q, channel, catalogType } = Route.useSearch();
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
    queryKey: queryKeys.integrationCatalog(
      channel,
      catalogType,
      q ?? "",
      status,
      sort,
    ),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listIntegrationCatalogPage({
        channel,
        type: catalogType,
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
      search: (current) => ({ ...current, q: value || undefined }),
    });
  }

  function updateChannel(nextChannel: "api" | "ai") {
    void navigate({
      replace: true,
      resetScroll: false,
      search: (current) => ({
        ...current,
        channel: nextChannel,
        catalogType: nextChannel === "api" ? undefined : current.catalogType,
      }),
    });
  }

  function updateType(nextType: IntegrationType | "all") {
    void navigate({
      replace: true,
      resetScroll: false,
      search: (current) => ({
        ...current,
        channel: "ai",
        catalogType: nextType === "all" ? undefined : nextType,
      }),
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Integration Catalog"
        description="Browse provider connectors available to this organization. Register an Integration first, then configure unit-specific Sources."
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/organization/integrations/new">
                <Plus data-icon="inline-start" />
                Add integration
              </Link>
            </Button>
          ) : null
        }
      />
      <div
        className="flex flex-wrap items-center gap-2"
        role="tablist"
        aria-label="Integration connector type"
      >
        <Button
          type="button"
          variant={channel === "api" ? "secondary" : "ghost"}
          role="tab"
          aria-selected={channel === "api"}
          onClick={() => updateChannel("api")}
        >
          API
        </Button>
        <Button
          type="button"
          variant={channel === "ai" ? "secondary" : "ghost"}
          role="tab"
          aria-selected={channel === "ai"}
          onClick={() => updateChannel("ai")}
        >
          MCP
        </Button>
      </div>
      <ListToolbar>
        <ListSearch
          value={q ?? ""}
          onChange={updateSearch}
          placeholder="Search the Integration Catalog…"
          label="Search Integration Catalog"
        />
        {channel === "ai" ? (
          <fieldset
            className="flex shrink-0 items-center gap-1 rounded-md border p-0.5"
            aria-label="Filter MCP connectors"
          >
            {(["all", IntegrationType.Ai, IntegrationType.Mcp] as const).map(
              (type) => (
                <Button
                  key={type}
                  type="button"
                  size="sm"
                  variant={catalogType === type ? "secondary" : "ghost"}
                  aria-pressed={catalogType === type}
                  onClick={() => updateType(type)}
                >
                  {type === "all" ? "All" : type.toUpperCase()}
                </Button>
              ),
            )}
          </fieldset>
        ) : null}
        <ListFilter
          value={status}
          onChange={(value) =>
            setStatus(value as IntegrationCatalogStatus | "all")
          }
          options={statuses}
          label="Filter Integration Catalog by status"
        />
        <ListFilter
          value={sort}
          onChange={(value) => setSort(value as typeof sort)}
          options={sorts}
          label="Sort Integration Catalog"
        />
      </ListToolbar>
      <ListResultsHeader
        count={items.length}
        label="visible connectors"
        meta={`${total} available`}
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
    <Card
      className={
        available
          ? "h-full"
          : "h-full cursor-default opacity-[0.85] shadow-none"
      }
    >
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
        <span className="shrink-0 rounded-full border bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          {statusLabel}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
          <span className="rounded-full border px-2 py-1">
            {entry.type.toUpperCase()}
          </span>
          {entry.capabilities.map((capability) => (
            <span key={capability} className="rounded-full border px-2 py-1">
              {capability}
            </span>
          ))}
        </div>
        {available && canManage ? (
          <Button variant="outline" size="sm" asChild>
            <Link
              to="/organization/integrations/new"
              search={{ provider: entry.provider, type: entry.type }}
            >
              Register {entry.name}
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
