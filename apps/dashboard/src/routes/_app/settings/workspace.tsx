import type { OrganizationOnboardingProjection } from "@encois/contracts/browser";
import { CoordinationMode, Permission } from "@encois/contracts/browser";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { CircleAlert, Radio, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/pill";
import {
  ProductTerm,
  setProductTooltipsEnabled,
  useProductTooltipsEnabled,
} from "@/components/product-term";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardButton,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { updateOrganizationOnboarding } from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { useOrganization } from "@/lib/organization-context";
import { usePermissions } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings/workspace")({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.SettingsRead))
      throw redirect({ to: "/forbidden" });
  },
  component: WorkspaceSettingsPage,
});

function WorkspaceSettingsPage() {
  const { onboarding, organizationName, isLoading, error } = useOrganization();
  const { can } = usePermissions();
  const productTooltipsEnabled = useProductTooltipsEnabled();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Workspace settings"
        description={`Organization-managed defaults for ${organizationName ?? "this workspace"}.`}
      />
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>Workspace organization state could not be loaded: {error}</span>
        </div>
      ) : null}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">
          Loading organization-managed workspace state…
        </p>
      ) : null}
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontal
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            Workspace
          </CardTitle>
          <CardDescription>
            Workspace preferences are managed by your organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-3 text-sm">
            <span className="text-muted-foreground">Organization name</span>
            <span className="font-medium">
              {organizationName ?? "Not available"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Scope and investigation context are resolved by the organization
            control plane for the active session.
          </p>
          <div className="border-t pt-5">
            <p className="text-sm font-medium">Product term explanations</p>
            <label
              className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm"
              htmlFor="settings-product-tooltips"
            >
              <input
                id="settings-product-tooltips"
                type="checkbox"
                checked={productTooltipsEnabled}
                onChange={(event) =>
                  setProductTooltipsEnabled(event.target.checked)
                }
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="block font-medium">
                  Explain product terms on hover
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Show definitions for terms such as{" "}
                  <ProductTerm term="coordinator" /> and{" "}
                  <ProductTerm term="knowledgeSource" />. This preference is
                  saved in this browser.
                </span>
              </span>
            </label>
          </div>
        </CardContent>
      </Card>

      {onboarding && onboarding.status !== "ready" ? (
        <OnboardingConfigurationCard
          onboarding={onboarding}
          canManage={can(Permission.OnboardingManage)}
        />
      ) : null}
    </div>
  );
}

function OnboardingConfigurationCard({
  onboarding,
  canManage,
}: {
  onboarding: OrganizationOnboardingProjection;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState(onboarding.coordinationMode);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setMode(onboarding.coordinationMode);
  }, [onboarding.coordinationMode]);

  const selectionChanged = onboarding.coordinationMode !== mode;
  const save = useMutation({
    mutationFn: () => updateOrganizationOnboarding({ coordinationMode: mode }),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.organization(),
      });
    },
  });

  const isInitializing = onboarding.status === "initializing";

  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              Workspace initialization
            </CardTitle>
            <CardDescription>
              Choose how the organization Coordinator should begin.
            </CardDescription>
          </div>
          <StatusPill
            status={onboarding.status}
            label={onboardingStatusLabel(onboarding.status)}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {!canManage ? (
          <div
            role="status"
            className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground"
          >
            You can view the current initialization state, but changing it
            requires{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              onboarding:manage
            </code>
            . The browser never supplies Coordinator or Temporal runtime IDs.
          </div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2">
          <ModeOption
            selected={mode === CoordinationMode.StartCoordinator}
            onClick={() => {
              setSaved(false);
              setMode(CoordinationMode.StartCoordinator);
            }}
            disabled={!canManage || isInitializing}
            icon={Sparkles}
            title="Start the Coordinator"
            description="Recommended. Start an audited Coordinator run after the catalog choices are saved."
          />
          <ModeOption
            selected={mode === CoordinationMode.ConnectOnly}
            onClick={() => {
              setSaved(false);
              setMode(CoordinationMode.ConnectOnly);
            }}
            disabled={!canManage || isInitializing}
            icon={Radio}
            title="Connect sources only"
            description="Save the organization setup and leave the Coordinator stopped until an administrator starts it."
          />
        </div>

        {save.error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            Could not save initialization settings: {save.error.message}
          </p>
        ) : null}
        {saved ? (
          <p
            role="status"
            className="rounded-md border border-primary/30 bg-primary/[0.05] p-3 text-sm text-primary"
          >
            Initialization settings saved. The Dashboard will show the next
            available Coordinator action.
          </p>
        ) : null}
        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {isInitializing
              ? "Initialization is already in progress. Wait for the current control-plane operation to finish."
              : "Saving changes returns the organization to Pending until initialization is explicitly started."}
          </p>
          <Button
            type="button"
            onClick={() => save.mutate()}
            disabled={
              !canManage ||
              isInitializing ||
              save.isPending ||
              !selectionChanged
            }
          >
            {save.isPending
              ? "Saving…"
              : saved
                ? "Saved"
                : "Save initialization settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ModeOption({
  selected,
  onClick,
  disabled,
  icon: Icon,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  disabled: boolean;
  icon: typeof Sparkles;
  title: string;
  description: string;
}) {
  return (
    <CardButton
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "items-start gap-3 p-4",
        selected ? "border-primary bg-accent" : "bg-background",
      )}
    >
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-md ${selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {description}
        </span>
      </span>
      <span
        className={`mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-primary bg-primary text-primary-foreground" : ""}`}
      >
        {selected ? <Check className="size-3" aria-hidden="true" /> : null}
      </span>
    </CardButton>
  );
}

function onboardingStatusLabel(
  status: OrganizationOnboardingProjection["status"],
): string {
  return {
    pending: "Pending",
    initializing: "Initializing",
    ready: "Ready",
    failed: "Needs attention",
  }[status];
}
