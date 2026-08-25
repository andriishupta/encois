import {
  type IntegrationProjection,
  IntegrationStatus,
  type IntegrationUpdateRequest,
  Permission,
  type WebhookEndpointProjection,
} from "@encois/contracts";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
  CheckCircle2,
  Clock3,
  Copy,
  PlugZap,
  Power,
  RefreshCw,
  Save,
  ShieldCheck,
  WandSparkles,
  Webhook,
} from "lucide-react";
import { useState } from "react";
import { EmptyPanel } from "@/components/empty-panel";
import { InlineError } from "@/components/inline-error";
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
  getKnowledgeSource,
  getWebhookEndpoint,
  isApiError,
  listIntegrations,
  listKnowledgeSources,
  provisionWebhookEndpoint,
  rotateWebhookEndpoint,
  setWebhookEndpointStatus,
  startIntegrationAuthorization,
  updateIntegration,
} from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { formatDate, humanizeKey } from "@/lib/formatters";
import { useOrganization } from "@/lib/organization-context";
import { useCan } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute(
  "/_app/organization/integrations/$integrationId",
)({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.IntegrationsRead))
      throw redirect({ to: "/forbidden" });
  },
  component: IntegrationDetailPage,
});

function IntegrationDetailPage() {
  const { integrationId } = Route.useParams();
  const queryClient = useQueryClient();
  const { units, currentUnitId, members } = useOrganization();
  const selectedScopeUnitId = units.some((unit) => unit.id === currentUnitId)
    ? currentUnitId
    : undefined;
  const integrations = useQuery({
    queryKey: queryKeys.integrations(selectedScopeUnitId),
    queryFn: () => listIntegrations({ scopeUnitId: selectedScopeUnitId }),
  });
  const actor = members.find(
    (member) => member.id === getAuthSession()?.userId,
  );
  const canManage =
    useCan(Permission.IntegrationsManage) &&
    (actor?.roleKey === "organization_admin" || actor?.roleKey === "admin");
  const canViewSources = useCan(Permission.KnowledgeRead);
  const [activeTab, setActiveTab] = useState<IntegrationTab>("overview");
  const sources = useQuery({
    queryKey: queryKeys.sources(selectedScopeUnitId),
    queryFn: () => listKnowledgeSources({ scopeUnitId: selectedScopeUnitId }),
    enabled: canViewSources,
  });
  const integration = integrations.data?.find(
    (item) => item.id === integrationId,
  );
  const integrationSources =
    sources.data?.filter((source) => source.integrationId === integrationId) ??
    [];
  const webhookEndpoint = useQuery({
    queryKey: queryKeys.webhookEndpoint(integrationId),
    queryFn: () => getWebhookEndpoint(integrationId),
    enabled: Boolean(integration),
  });
  const [revealedWebhookSecret, setRevealedWebhookSecret] = useState<
    string | null
  >(null);
  const sourceDetailQueries = useQueries({
    queries: integrationSources.slice(0, 20).map((source) => ({
      queryKey: queryKeys.source(source.id),
      queryFn: () => getKnowledgeSource(source.id),
      enabled: activeTab === "sync",
    })),
  });
  const syncHistory = sourceDetailQueries
    .flatMap((query) =>
      query.data
        ? query.data.ingestionRuns.map((run) => ({
            source: query.data.source,
            run,
          }))
        : [],
    )
    .sort((left, right) =>
      right.run.updatedAt.localeCompare(left.run.updatedAt),
    );
  const mutation = useMutation({
    mutationFn: (input: IntegrationUpdateRequest) =>
      updateIntegration(integrationId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.integrationsRoot(),
      });
    },
  });
  const authorizationMutation = useMutation({
    mutationFn: () => startIntegrationAuthorization(integrationId),
    onSuccess: (result) => {
      if (result.authorizationUrl)
        window.location.assign(result.authorizationUrl);
    },
  });
  const webhookProvisionMutation = useMutation({
    mutationFn: (endpointKey?: string) =>
      provisionWebhookEndpoint(integrationId, endpointKey),
    onSuccess: async (result) => {
      setRevealedWebhookSecret(result.secret);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.webhookEndpoint(integrationId),
      });
    },
  });
  const webhookRotateMutation = useMutation({
    mutationFn: () => rotateWebhookEndpoint(integrationId),
    onSuccess: async (result) => {
      setRevealedWebhookSecret(result.secret);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.webhookEndpoint(integrationId),
      });
    },
  });
  const webhookStatusMutation = useMutation({
    mutationFn: (status: "active" | "disabled") =>
      setWebhookEndpointStatus(integrationId, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.webhookEndpoint(integrationId),
      });
    },
  });

  if (integrations.isLoading)
    return (
      <p className="text-sm text-muted-foreground">Loading integration…</p>
    );
  if (integrations.isError)
    return (
      <InlineError
        title="Integration unavailable"
        message={integrations.error.message}
        onRetry={() => integrations.refetch()}
        retrying={integrations.isFetching}
      />
    );
  if (!integration)
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyPanel
            icon={PlugZap}
            title="Integration not found"
            description="This integration is not visible in the current organization scope."
          />
        </CardContent>
      </Card>
    );

  const providerName = integration.provider;

  function saveChanges(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("displayName") ?? "").trim();
    const input: IntegrationUpdateRequest = displayName ? { displayName } : {};
    if (Object.keys(input).length > 0) mutation.mutate(input);
  }

  function disableIntegration() {
    if (!canManage || integration?.status === IntegrationStatus.Disabled)
      return;
    if (
      !window.confirm(
        "Disable this Integration? Existing Sources will stop receiving provider updates until it is authorized again.",
      )
    )
      return;
    mutation.mutate({ status: IntegrationStatus.Disabled });
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={`${providerName} integration`}
        description="Organization-level provider connection, permissions, and unit-scoped Sources."
      />

      <div
        role="tablist"
        aria-label="Integration detail sections"
        className="flex flex-wrap gap-1 rounded-lg border bg-muted/20 p-1"
      >
        {integrationTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-md px-3 py-2 text-sm transition-colors ${activeTab === tab.key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:bg-background/70 hover:text-foreground"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        className={
          activeTab === "overview" || activeTab === "permissions"
            ? "block"
            : "hidden"
        }
      >
        <Card className={activeTab === "overview" ? undefined : "hidden"}>
          <CardHeader>
            <CardTitle>Connection settings</CardTitle>
            <CardDescription>
              Connection details are managed securely. Provider credentials are
              never shown here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-5" onSubmit={saveChanges}>
              <label
                className="flex flex-col gap-2 text-sm font-medium"
                htmlFor="display-name"
              >
                Display name
                <input
                  id="display-name"
                  name="displayName"
                  defaultValue={integration.name}
                  disabled={!canManage}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
              <label
                className="flex flex-col gap-2 text-sm font-medium"
                htmlFor="integration-status"
              >
                Status
                <div
                  id="integration-status"
                  aria-live="polite"
                  className="flex min-h-9 items-center rounded-md border border-input bg-muted/30 px-3 text-sm"
                >
                  {humanizeKey(integration.status)}
                </div>
                <p className="text-xs font-normal text-muted-foreground">
                  Authorization, health, degradation, and reauthorization states
                  are server-managed. The only manual lifecycle action is
                  disabling this connection.
                </p>
              </label>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="flex items-start gap-3">
                  <ShieldCheck
                    className="mt-0.5 size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-medium">
                      Read-only provider access
                    </p>
                    <p className="text-xs text-muted-foreground">
                      External write tools remain disabled in the MVP.
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">
                  Enforced
                </span>
              </div>
              <div className="flex flex-col gap-3 rounded-lg border border-dashed bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <WandSparkles
                    className="mt-0.5 size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-medium">
                      Provider authorization
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Open the provider consent flow through the server-side
                      adapter. No credential is entered or returned in the
                      dashboard.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canManage || authorizationMutation.isPending}
                  onClick={() => authorizationMutation.mutate()}
                >
                  {authorizationMutation.isPending
                    ? "Starting…"
                    : integration.credentialConfigured
                      ? "Reauthorize"
                      : "Start authorization"}
                </Button>
              </div>
              {authorizationMutation.isError ? (
                <p className="text-sm text-destructive">
                  {isApiError(authorizationMutation.error) &&
                  authorizationMutation.error.code ===
                    "INTEGRATION_AUTHORIZATION_UNAVAILABLE"
                    ? "Provider authorization is not configured for this deployment yet."
                    : `Could not start authorization: ${authorizationMutation.error.message}`}
                </p>
              ) : null}
              {authorizationMutation.isSuccess &&
              !authorizationMutation.data.authorizationUrl ? (
                <p className="text-sm text-muted-foreground">
                  Authorization is pending. The provider adapter will update
                  this integration when the callback completes.
                </p>
              ) : null}
              {mutation.isError ? (
                <p className="text-sm text-destructive">
                  Could not save changes: {mutation.error.message}
                </p>
              ) : null}
              {mutation.isSuccess ? (
                <p className="text-sm text-muted-foreground">Changes saved.</p>
              ) : null}
              <div className="flex items-center justify-between gap-4 border-t pt-5">
                {!canManage ? (
                  <span className="text-xs text-muted-foreground">
                    Read-only access
                  </span>
                ) : (
                  <span />
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  {canManage &&
                  integration.status !== IntegrationStatus.Disabled ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={disableIntegration}
                      disabled={mutation.isPending}
                    >
                      <Power data-icon="inline-start" />
                      Disable integration
                    </Button>
                  ) : null}
                  <Button
                    type="submit"
                    disabled={!canManage || mutation.isPending}
                  >
                    <Save data-icon="inline-start" />
                    {mutation.isPending ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className={activeTab === "permissions" ? undefined : "hidden"}>
          <CardHeader>
            <CardTitle>Organization permissions</CardTitle>
            <CardDescription>
              Provider permissions are configured once for the organization.
              Source access is controlled by each Source scope.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-sm font-medium">
                Organization-level Integration
              </p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                Resolved securely
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              Credentials are intentionally not shown in the browser and are
              handled securely.
            </p>
            <div className="rounded-lg border bg-muted/20 p-4 text-sm">
              <p className="font-medium">Organization connection</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {integration.grantedScopes?.length ?? 0} provider permission
                {integration.grantedScopes?.length === 1 ? "" : "s"} · Sources
                configure unit-level resource access.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Credential state:{" "}
                {integration.credentialConfigured
                  ? "configured"
                  : "not configured"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className={activeTab === "overview" ? undefined : "hidden"}>
        <CardHeader>
          <CardTitle>Authorization lifecycle</CardTitle>
          <CardDescription>
            Provider credentials remain outside the dashboard; this view reports
            the server-side state.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <LifecycleState
            label="Registered"
            active={true}
            detail="Integration record exists"
          />
          <LifecycleState
            label="Authorized"
            active={Boolean(
              integration.authorizedAt || integration.credentialConfigured,
            )}
            detail={
              integration.authorizedAt
                ? formatDate(integration.authorizedAt)
                : "Awaiting provider adapter"
            }
          />
          <LifecycleState
            label="Active"
            active={integration.status === IntegrationStatus.Active}
            detail={
              integration.status === IntegrationStatus.Active
                ? "Available to Sources"
                : "Enable after health check"
            }
          />
          <LifecycleState
            label="Health"
            active={integration.status === IntegrationStatus.Active}
            detail={
              integration.lastHealthCheckAt
                ? formatDate(integration.lastHealthCheckAt)
                : "Not checked"
            }
          />
        </CardContent>
        {integration.lastError && activeTab !== "errors" ? (
          <div className="mx-6 mb-6 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {integration.lastError}
          </div>
        ) : null}
      </Card>

      <WebhookIngressCard
        active={activeTab === "overview"}
        canManage={canManage}
        integration={integration}
        query={webhookEndpoint}
        revealedSecret={revealedWebhookSecret}
        onDismissSecret={() => setRevealedWebhookSecret(null)}
        onProvision={(endpointKey) =>
          webhookProvisionMutation.mutate(endpointKey)
        }
        onRotate={() => {
          if (
            window.confirm(
              "Rotate this webhook secret? The current provider secret will stop working immediately.",
            )
          )
            webhookRotateMutation.mutate();
        }}
        onSetStatus={(status) => {
          if (
            status === "disabled" &&
            !window.confirm(
              "Disable this webhook endpoint? Provider deliveries will receive a not-found response.",
            )
          )
            return;
          webhookStatusMutation.mutate(status);
        }}
        isMutating={
          webhookProvisionMutation.isPending ||
          webhookRotateMutation.isPending ||
          webhookStatusMutation.isPending
        }
        mutationError={
          webhookProvisionMutation.error ??
          webhookRotateMutation.error ??
          webhookStatusMutation.error
        }
      />

      <Card className={activeTab === "sync" ? undefined : "hidden"}>
        <CardHeader>
          <CardTitle>Sync history</CardTitle>
          <CardDescription>
            Ingestion runs for Sources connected to this Integration. Runtime
            identifiers stay available only inside the Source detail.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3 text-sm text-muted-foreground">
            Webhook-triggered ingestion uses the signed Gateway ingress,
            retained payload, delivery idempotency, and the same scoped
            ingestion workflow as manual sync. Real provider delivery and hosted
            retry behavior still require release smoke tests.
          </div>
          {!canViewSources ? (
            <EmptyPanel
              icon={PlugZap}
              title="Source history is restricted"
              description="Source visibility is not included in the current permissions."
            />
          ) : null}
          {canViewSources &&
          (sources.isLoading ||
            sourceDetailQueries.some((query) => query.isLoading)) ? (
            <p className="text-sm text-muted-foreground">
              Loading sync history…
            </p>
          ) : null}
          {canViewSources &&
          sourceDetailQueries.some((query) => query.isError) ? (
            <InlineError
              title="Some Source history is unavailable"
              message="The Source details could not be loaded in this view."
              onRetry={() =>
                Promise.all(sourceDetailQueries.map((query) => query.refetch()))
              }
              retrying={sourceDetailQueries.some((query) => query.isFetching)}
            />
          ) : null}
          {canViewSources &&
          !sources.isLoading &&
          !sourceDetailQueries.some((query) => query.isLoading) &&
          !syncHistory.length ? (
            <EmptyPanel
              icon={Clock3}
              title="No ingestion runs yet"
              description={
                integrationSources.length
                  ? "Connected Sources have not recorded an ingestion run in this scope."
                  : "Create a Source after this Integration becomes active."
              }
            />
          ) : null}
          {syncHistory.map(({ source, run }) => (
            <div
              key={run.id}
              className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <Link
                  to="/memory/sources/$sourceId"
                  params={{ sourceId: source.id }}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {source.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {humanizeKey(run.trigger)} · {humanizeKey(run.status)} ·{" "}
                  {run.factsCount} facts
                </p>
              </div>
              <div className="shrink-0 text-left text-xs text-muted-foreground sm:text-right">
                <p>{formatDate(run.updatedAt)}</p>
                {run.error ? (
                  <p className="max-w-64 truncate text-destructive">
                    {run.error}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {canViewSources ? (
        <Card className={activeTab === "sources" ? undefined : "hidden"}>
          <CardHeader>
            <CardTitle>Sources</CardTitle>
            <CardDescription>
              Sources currently referencing this Integration in your visible
              scope.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {sources.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading Sources…</p>
            ) : null}
            {sources.isError ? (
              <InlineError
                title="Sources unavailable"
                message={sources.error.message}
                onRetry={() => sources.refetch()}
                retrying={sources.isFetching}
              />
            ) : null}
            {!sources.isLoading &&
            !sources.isError &&
            !integrationSources.length ? (
              <EmptyPanel
                icon={PlugZap}
                title="No Sources use this Integration"
                description="Create a Source after the connection is authorized and active."
              />
            ) : null}
            {integrationSources.map((source) => (
              <Link
                key={source.id}
                  to="/memory/sources/$sourceId"
                params={{ sourceId: source.id }}
                className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-accent"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {source.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {source.status.replace("_", " ")} ·{" "}
                    {source.currentRevisionId
                      ? "revision available"
                      : "no revision yet"}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">Open</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "errors" ? (
        <Card>
          <CardHeader>
            <CardTitle>Errors and recovery</CardTitle>
            <CardDescription>
              Provider failures are reported by the server-side adapter. The
              dashboard never exposes credentials or raw provider responses.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {integration.lastError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {integration.lastError}
              </div>
            ) : (
              <EmptyPanel
                icon={CheckCircle2}
                title="No reported provider errors"
                description="The last health callback did not report an error for this integration."
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!canManage || authorizationMutation.isPending}
                onClick={() => authorizationMutation.mutate()}
              >
                {authorizationMutation.isPending
                  ? "Starting…"
                  : "Reconnect provider"}
              </Button>
              <Link
                to="/activity"
                className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent"
              >
                Open Activity
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "capabilities" ? (
        <Card>
          <CardHeader>
            <CardTitle>Capabilities</CardTitle>
            <CardDescription>
              Read capabilities granted to this organization Integration.
              Workflow creation resolves Sources server-side against the
              selected scope.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {integration.grantedScopes?.length ? (
                integration.grantedScopes.map((scope) => (
                  <span
                    key={scope}
                    className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground"
                  >
                    {scope}
                  </span>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No provider permissions were returned.
                </p>
              )}
            </div>
            <div className="rounded-lg border bg-muted/20 p-4 text-sm">
              <p className="font-medium">Execution availability</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {integration.status === IntegrationStatus.Active
                  ? "This Integration can be considered only when a matching Source exists in the workflow scope."
                  : "Only active, authorized connections can satisfy a Source or workflow capability."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

type IntegrationTab =
  | "overview"
  | "permissions"
  | "sources"
  | "sync"
  | "errors"
  | "capabilities";

const integrationTabs: readonly { key: IntegrationTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "permissions", label: "Permissions" },
  { key: "sources", label: "Sources" },
  { key: "sync", label: "Sync history" },
  { key: "errors", label: "Errors" },
  { key: "capabilities", label: "Capabilities" },
];

function LifecycleState({
  label,
  active,
  detail,
}: {
  label: string;
  active: boolean;
  detail: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {active ? (
          <CheckCircle2
            className="size-4 text-emerald-600"
            aria-hidden="true"
          />
        ) : (
          <Clock3 className="size-4 text-muted-foreground" aria-hidden="true" />
        )}
        {label}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function WebhookIngressCard({
  active,
  canManage,
  integration,
  query,
  revealedSecret,
  onDismissSecret,
  onProvision,
  onRotate,
  onSetStatus,
  isMutating,
  mutationError,
}: {
  active: boolean;
  canManage: boolean;
  integration: IntegrationProjection;
  query: {
    data?: WebhookEndpointProjection | null;
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
  };
  revealedSecret: string | null;
  onDismissSecret: () => void;
  onProvision: (endpointKey?: string) => void;
  onRotate: () => void;
  onSetStatus: (status: "active" | "disabled") => void;
  isMutating: boolean;
  mutationError: Error | null;
}) {
  const [endpointKey, setEndpointKey] = useState("");
  const [copied, setCopied] = useState(false);
  const endpoint = query.data ?? null;

  async function copySecret() {
    if (!revealedSecret || !navigator.clipboard) return;
    await navigator.clipboard.writeText(revealedSecret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function errorMessage(error: Error | null) {
    if (!error) return null;
    if (isApiError(error)) {
      if (error.code === "WEBHOOK_ENDPOINT_EXISTS")
        return "This Integration already has an active endpoint.";
      if (error.code === "INTEGRATION_NOT_ACTIVE")
        return "Authorize and activate the Integration before provisioning webhook ingress.";
      if (error.code === "WEBHOOK_SECRET_STORE_UNAVAILABLE")
        return "Secret Manager is unavailable. The endpoint was not exposed; check again after the deployment is ready.";
      if (error.code === "WEBHOOK_ENDPOINT_DISABLED")
        return "Enable the endpoint before rotating its secret.";
    }
    return error.message;
  }

  return (
    <Card className={active ? undefined : "hidden"}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Webhook
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              Webhook ingress
            </CardTitle>
            <CardDescription>
              Signed provider delivery is managed here. Secrets are stored
              server-side and shown only once after create or rotate.
            </CardDescription>
          </div>
          {endpoint ? (
            <span
              className={`rounded-full px-2.5 py-1 text-xs ${endpoint.status === IntegrationStatus.Active ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-secondary text-secondary-foreground"}`}
            >
              {humanizeKey(endpoint.status)}
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">
            Loading webhook endpoint…
          </p>
        ) : null}
        {query.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load webhook endpoint:{" "}
            {query.error?.message ?? "Unknown error"}
          </p>
        ) : null}

        {!query.isLoading && !query.isError && !endpoint ? (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed bg-muted/20 p-4">
            <div>
              <p className="text-sm font-medium">Provision a signed endpoint</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The backend creates the endpoint binding and stores its signing
                secret. The browser never supplies an integration or
                organization ID.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label
                className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium"
                htmlFor="webhook-endpoint-key"
              >
                Endpoint key{" "}
                <span className="font-normal text-muted-foreground">
                  optional
                </span>
                <input
                  id="webhook-endpoint-key"
                  value={endpointKey}
                  onChange={(event) => setEndpointKey(event.target.value)}
                  placeholder={`${integration.provider.toLowerCase()}-events`}
                  disabled={!canManage || isMutating}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
              <Button
                type="button"
                disabled={
                  !canManage ||
                  isMutating ||
                  integration.status !== IntegrationStatus.Active
                }
                onClick={() => onProvision(endpointKey.trim() || undefined)}
              >
                <Webhook data-icon="inline-start" />
                {isMutating ? "Provisioning…" : "Provision endpoint"}
              </Button>
            </div>
            {integration.status !== IntegrationStatus.Active ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                The Integration must be active before it can receive provider
                events.
              </p>
            ) : null}
          </div>
        ) : null}

        {endpoint ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Public delivery URL
              </p>
              {endpoint.url ? (
                <code className="mt-2 block break-all text-xs">
                  {endpoint.url}
                </code>
              ) : (
                <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                  Public URL is not configured for this deployment.
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Provider: {endpoint.provider} · key:{" "}
                <code>{endpoint.endpointKey}</code> · secret:{" "}
                {endpoint.secretConfigured
                  ? "configured in Secret Manager"
                  : "not configured"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {endpoint.status === IntegrationStatus.Disabled ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canManage || isMutating}
                  onClick={() => onSetStatus("active")}
                >
                  <Power />
                  {isMutating ? "Enabling…" : "Enable endpoint"}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canManage || isMutating}
                  onClick={() => onSetStatus("disabled")}
                >
                  <Power />
                  {isMutating ? "Disabling…" : "Disable endpoint"}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  !canManage ||
                  isMutating ||
                  endpoint.status === IntegrationStatus.Disabled
                }
                onClick={onRotate}
              >
                <RefreshCw />
                {isMutating ? "Rotating…" : "Rotate secret"}
              </Button>
            </div>
          </div>
        ) : null}

        {revealedSecret ? (
          <div
            role="status"
            className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-medium">
                  Copy this signing secret now
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  It will not be returned by later reads. Update the provider
                  before sending events.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copySecret}
              >
                <Copy />
                {copied ? "Copied" : "Copy secret"}
              </Button>
            </div>
            <code className="mt-3 block break-all rounded-md border bg-background p-3 text-xs">
              {revealedSecret}
            </code>
            <button
              type="button"
              className="mt-3 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              onClick={onDismissSecret}
            >
              Dismiss secret
            </button>
          </div>
        ) : null}

        {mutationError ? (
          <p className="text-sm text-destructive">
            {errorMessage(mutationError)}
          </p>
        ) : null}
        {!canManage ? (
          <p className="text-xs text-muted-foreground">
            Read-only access: an Integration manager is required to provision,
            rotate, or disable webhook ingress.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
