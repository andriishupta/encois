import {
  type IntegrationCatalogProjection,
  IntegrationCatalogStatus,
  type IntegrationProjection,
  IntegrationStatus,
  IntegrationType,
  Permission,
} from "@encois/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import {
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Github,
  PlugZap,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
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
import { ProductTerm } from "@/components/product-term";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listIntegrationCatalogPage, listIntegrationsPage } from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { humanizeKey, shortIdentifier } from "@/lib/formatters";
import { useOrganization } from "@/lib/organization-context";
import { useCan } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/organization/integrations/")({
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
  component: IntegrationsPage,
});

const pageSize = 10;

function IntegrationsPage() {
  const navigate = useNavigate();
  const { q, channel, catalogType } = Route.useSearch();
  const { organizationName, units, currentUnitId, members } = useOrganization();
  const selectedScopeUnitId = units.some((unit) => unit.id === currentUnitId)
    ? currentUnitId
    : undefined;
  const currentUnit = units.find((unit) => unit.id === selectedScopeUnitId);
  const scopeLabel =
    currentUnit?.type === "organization"
      ? (organizationName ?? currentUnit.name)
      : (currentUnit?.name ?? "current scope");
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
  const [catalogView, setCatalogView] = useState<ListViewMode>("grid");
  const [catalogStatus, setCatalogStatus] = useState<
    IntegrationCatalogStatus | "all"
  >("all");
  const [catalogSort, setCatalogSort] = useState<
    "updated-desc" | "updated-asc" | "name-asc" | "status"
  >("status");
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
  const catalog = useInfiniteQuery({
    queryKey: queryKeys.integrationCatalog(
      channel,
      catalogType,
      q ?? "",
      catalogStatus,
      catalogSort,
    ),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listIntegrationCatalogPage({
        channel,
        type: catalogType,
        query: q,
        status: catalogStatus,
        sort: catalogSort,
        limit: pageSize,
        offset: pageParam,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.offset + lastPage.pagination.limit
        : undefined,
  });
  const catalogItems = useMemo(
    () => catalog.data?.pages.flatMap((page) => page.items) ?? [],
    [catalog.data],
  );
  const firstCatalogPage = catalog.data?.pages[0];
  const catalogTotal = firstCatalogPage?.pagination.total ?? 0;
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
      search: (current) => ({ ...current, q: value || undefined }),
    });
  }

  function updateCatalogChannel(nextChannel: "api" | "ai") {
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

  function updateCatalogType(nextType: IntegrationType | "all") {
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
        title={<ProductTerm term="integration" plural />}
        description={
          <>
            Organization-level provider integrations are available to authorized
            unit-scoped Sources. Current scope: {scopeLabel}.
          </>
        }
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/organization/integrations/new">
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
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Existing Integrations
          </h2>
          <p className="text-sm text-muted-foreground">
            Configured provider connections visible in the current organization
            scope.
          </p>
        </div>
      </div>
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
        <ListFilter
          value={sort}
          onChange={(value) => setSort(value as typeof sort)}
          options={sorts}
          label="Sort Integrations"
        />
      </ListToolbar>
      <ListResultsHeader
        count={items.length}
        label="visible integrations"
        meta={`${total} available`}
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
            <IntegrationPreviewCard
              integration={integration}
              view={view}
              scopeLabel={scopeLabel}
            />
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
                    No Integrations in {scopeLabel}
                    {currentUnit?.type === "organization" ? "" : " scope"}
                  </>
                )
              }
              description={
                q || status !== "all"
                  ? "Change the search or status filter."
                  : `No connected Integrations are available in ${scopeLabel}${currentUnit?.type === "organization" ? "" : " scope"}.`
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
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Integration Catalog
          </h2>
          <p className="text-sm text-muted-foreground">
            Organization-level connectors are listed from the integration
            catalog. Unit-specific repositories, projects, and channels remain
            Sources.
          </p>
        </div>
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
            onClick={() => updateCatalogChannel("api")}
          >
            API
          </Button>
          <Button
            type="button"
            variant={channel === "ai" ? "secondary" : "ghost"}
            role="tab"
            aria-selected={channel === "ai"}
            onClick={() => updateCatalogChannel("ai")}
          >
            MCP
          </Button>
        </div>
        <ListToolbar>
          <ListSearch
            value={q ?? ""}
            onChange={updateQuery}
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
                    onClick={() => updateCatalogType(type)}
                  >
                    {type === "all" ? "All" : type.toUpperCase()}
                  </Button>
                ),
              )}
            </fieldset>
          ) : null}
          <ListFilter
            value={catalogStatus}
            onChange={(value) =>
              setCatalogStatus(value as IntegrationCatalogStatus | "all")
            }
            options={[
              { value: "all", label: "All statuses" },
              ...Object.values(IntegrationCatalogStatus).map((value) => ({
                value,
                label: humanizeKey(value),
              })),
            ]}
            label="Filter Integration Catalog by status"
          />
          <ListFilter
            value={catalogSort}
            onChange={(value) => setCatalogSort(value as typeof catalogSort)}
            options={[
              { value: "status", label: "Status" },
              { value: "name-asc", label: "Name" },
              { value: "updated-desc", label: "Recently updated" },
              { value: "updated-asc", label: "Oldest updated" },
            ]}
            label="Sort Integration Catalog"
          />
        </ListToolbar>
        <ListResultsHeader
          count={catalogItems.length}
          label="visible connectors"
          meta={`${catalogTotal} available`}
          view={catalogView}
          onViewChange={setCatalogView}
        />
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
        {!catalog.isLoading && !catalog.isError && catalogItems.length ? (
          <ListCollection
            items={catalogItems}
            view={catalogView}
            getKey={(entry) => entry.key}
            renderItem={(entry) => (
              <IntegrationCatalogCard
                entry={entry}
                integrations={items}
                canManage={canManage}
              />
            )}
          />
        ) : null}
        {!catalog.isLoading && !catalog.isError && !catalogItems.length ? (
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
        {!catalog.isLoading && !catalog.isError && catalogItems.length ? (
          <ListPagination
            hasMore={Boolean(catalog.hasNextPage)}
            loading={catalog.isFetchingNextPage}
            onLoadMore={() => void catalog.fetchNextPage()}
          />
        ) : null}
      </section>
    </div>
  );
}

function IntegrationPreviewCard({
  integration,
  view,
  scopeLabel,
}: {
  integration: IntegrationProjection;
  view: ListViewMode;
  scopeLabel: string;
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
            ? "transition-colors group-hover:border-foreground/30 md:flex md:items-center md:justify-between"
            : "h-full transition-colors group-hover:border-foreground/30"
        }
      >
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 items-center justify-center rounded-md border bg-muted/30">
              <Icon
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <div className="flex flex-col gap-1.5">
              <CardTitle>{integration.name}</CardTitle>
              <CardDescription>
                {integration.provider} · {integration.type.toUpperCase()}
              </CardDescription>
            </div>
          </div>
          <ArrowUpRight
            className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {integration.status === IntegrationStatus.Active ? (
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
          ) : (
            <PlugZap className="size-3.5" aria-hidden="true" />
          )}
          <span>{humanizeKey(integration.status)}</span>
          <span className="rounded-full bg-secondary px-2 py-1">
            Visible in {scopeLabel}
          </span>
          <span className="ml-auto">
            ID: <span className="font-mono">{shortIdentifier(integration.id)}</span>
          </span>
        </CardContent>
      </Card>
    </Link>
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
