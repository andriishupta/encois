import {
  type IntegrationCreateRequest,
  IntegrationType,
  Permission,
} from "@encois/contracts/browser";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { ArrowLeft, PlugZap, Save } from "lucide-react";
import { type FormEvent, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createIntegration } from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { useOrganization } from "@/lib/organization-context";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/organization/integrations/new")({
  validateSearch: (search: Record<string, unknown>) => ({
    provider: typeof search.provider === "string" ? search.provider : undefined,
    type: Object.values(IntegrationType).includes(
      search.type as IntegrationType,
    )
      ? (search.type as IntegrationType)
      : undefined,
  }),
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.IntegrationsManage))
      throw redirect({ to: "/forbidden" });
  },
  component: NewIntegrationPage,
});

const providerScopes: Record<string, readonly string[]> = {
  github: ["code.read", "pull-requests.read", "activity.read"],
  gitlab: ["code.read", "pull-requests.read", "activity.read"],
  jira: ["issues.read", "activity.read"],
  linear: ["issues.read", "activity.read"],
  slack: ["messages.read", "activity.read"],
  "google-drive": ["documents.read"],
};

function NewIntegrationPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { members } = useOrganization();
  const requestedProvider = Route.useSearch().provider;
  const requestedType = Route.useSearch().type;
  const actor = members.find(
    (member) => member.id === getAuthSession()?.userId,
  );
  const organizationAdmin =
    actor?.roleKey === "organization_admin" || actor?.roleKey === "admin";
  const initialProvider = requestedProvider?.trim() || "github";
  const providerOptions = [
    { value: "github", label: "GitHub" },
    { value: "gitlab", label: "GitLab" },
    { value: "jira", label: "Jira" },
    { value: "linear", label: "Linear" },
    { value: "slack", label: "Slack" },
    { value: "google-drive", label: "Google Drive" },
    ...(initialProvider &&
    !["github", "gitlab", "jira", "linear", "slack", "google-drive"].includes(
      initialProvider,
    )
      ? [{ value: initialProvider, label: initialProvider }]
      : []),
  ];
  const [displayName, setDisplayName] = useState("");
  const [provider, setProvider] = useState(initialProvider);
  const [type, setType] = useState<IntegrationType>(
    requestedType ?? IntegrationType.Api,
  );
  const [grantedScopes, setGrantedScopes] = useState<string[]>(() => [
    ...(providerScopes[initialProvider] ?? []),
  ]);
  const mutation = useMutation({
    mutationFn: (input: IntegrationCreateRequest) => createIntegration(input),
    onSuccess: async (integration) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.integrationsRoot(),
      });
      await navigate({
        to: "/organization/integrations/$integrationId",
        params: { integrationId: integration.id },
      });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({
      displayName: displayName.trim(),
      provider,
      type,
      grantedScopes,
    });
  }

  function changeProvider(nextProvider: string) {
    setProvider(nextProvider);
    setGrantedScopes([...(providerScopes[nextProvider] ?? [])]);
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Register integration"
        description="Register an organization-level provider connection. Unit-specific projects, repositories, and channels are added later as Sources."
        actions={
          <Button variant="outline" asChild>
            <Link to="/organization/integrations">
              <ArrowLeft data-icon="inline-start" />
              Back to integrations
            </Link>
          </Button>
        }
      />
      <Card className="w-full">
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-md border bg-muted/30">
            <PlugZap
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
          <CardTitle>Connection registration</CardTitle>
          <CardDescription>
            This creates a pending, auditable integration record. Provider OAuth
            or secret provisioning is a separate step and must be completed
            before ingestion.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {organizationAdmin ? (
            <form className="flex flex-col gap-6" onSubmit={submit}>
              <div className="grid gap-5 sm:grid-cols-2">
                <label
                  className="flex flex-col gap-2 text-sm font-medium"
                  htmlFor="integration-name"
                >
                  Display name
                  <Input
                    id="integration-name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="GitHub Engineering"
                    required
                    minLength={2}
                    maxLength={160}
                  />
                </label>
                <label
                  className="flex flex-col gap-2 text-sm font-medium"
                  htmlFor="integration-provider"
                >
                  Provider
                  <Select
                    id="integration-provider"
                    value={provider}
                    onChange={(event) => changeProvider(event.target.value)}
                    options={providerOptions}
                  />
                </label>
                <label
                  className="flex flex-col gap-2 text-sm font-medium"
                  htmlFor="integration-type"
                >
                  Integration type
                  <Select
                    id="integration-type"
                    value={type}
                    onChange={(event) =>
                      setType(event.target.value as IntegrationType)
                    }
                    options={Object.values(IntegrationType).map((value) => ({
                      value,
                      label: value.toUpperCase(),
                    }))}
                  />
                </label>
              </div>
              <fieldset className="flex flex-col gap-3 rounded-lg border p-4">
                <legend className="px-1 text-sm font-medium">
                  Read capabilities
                </legend>
                <p className="text-xs text-muted-foreground">
                  These capabilities are recorded on the binding and used by
                  workflow provider preflight. Write capabilities are not
                  available here.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(providerScopes[provider] ?? []).map((scope) => (
                    <label
                      key={scope}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={grantedScopes.includes(scope)}
                        onChange={(event) =>
                          setGrantedScopes((current) =>
                            event.target.checked
                              ? [...new Set([...current, scope])]
                              : current.filter((item) => item !== scope),
                          )
                        }
                      />
                      {scope}
                    </label>
                  ))}
                </div>
              </fieldset>
              {mutation.isError ? (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
                >
                  Could not register integration: {mutation.error.message}
                </div>
              ) : null}
              <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-between">
                <Button variant="ghost" asChild>
                  <Link to="/organization/integrations">Cancel</Link>
                </Button>
                <Button
                  type="submit"
                  disabled={mutation.isPending || !displayName.trim()}
                >
                  {mutation.isPending ? (
                    "Registering…"
                  ) : (
                    <>
                      <Save data-icon="inline-start" />
                      Register organization integration
                    </>
                  )}
                </Button>
              </div>
            </form>
          ) : (
            <p className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
              Only organization administrators can register provider
              integrations. Unit managers can add Sources using an existing
              integration.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
