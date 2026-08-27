import { OrganizationOnboardingStatus, Permission } from "@encois/contracts";
import {
  useIsFetching,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import {
  AlertTriangle,
  ExternalLink,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { resetOrganizationOnboarding } from "@/lib/api";
import { clearAuthStorage, getAuthSession } from "@/lib/auth";
import { getBranding } from "@/lib/branding";
import {
  OrganizationProvider,
  useOrganization,
} from "@/lib/organization-context";
import { PermissionProvider, useCan } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app")({
  beforeLoad: () => {
    if (!getAuthSession()) {
      throw redirect({ to: "/login" });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  return (
    <PermissionProvider>
      <OrganizationProvider>
        <OrganizationReadinessGate />
      </OrganizationProvider>
    </PermissionProvider>
  );
}

function OrganizationReadinessGate() {
  const { error, errorCode, isLoading, onboarding } = useOrganization();
  const canManageOnboarding = useCan(Permission.OnboardingManage);
  const queryClient = useQueryClient();
  const isCheckingStatus =
    useIsFetching({ queryKey: queryKeys.organization() }) > 0;
  const location = useLocation();
  const navigate = useNavigate();
  const authenticationError = errorCode === "UNAUTHENTICATED";
  const branding = getBranding();
  const resetOnboarding = useMutation({
    mutationFn: resetOrganizationOnboarding,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.organization(),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sourcesRoot() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workflows() }),
      ]);
      await navigate({ to: "/onboarding/workspace" });
    },
  });

  useEffect(() => {
    if (
      onboarding?.status === OrganizationOnboardingStatus.Ready &&
      location.pathname.startsWith("/onboarding")
    ) {
      void navigate({ to: "/" });
    }
  }, [location.pathname, navigate, onboarding?.status]);

  async function recoverClientSession() {
    queryClient.clear();
    await clearAuthStorage();
    window.location.replace("/login");
  }

  if (isLoading) {
    return (
      <ReadinessFrame>
        <LoaderCircle
          className="size-6 animate-spin text-muted-foreground"
          aria-label="Loading workspace readiness"
        />
      </ReadinessFrame>
    );
  }

  if (errorCode === "ORGANIZATION_ONBOARDING_NOT_FOUND") {
    return (
      <ReadinessFrame>
        <div className="w-full max-w-lg rounded-xl border bg-background p-6 shadow-sm sm:p-8">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Workspace readiness
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            Onboarding state is unavailable
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            This organization has no control-plane onboarding state, so the
            workspace is paused until setup data is available. Apply the current
            control-plane migration, then check again.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.organization(),
                })
              }
            >
              Check again
            </Button>
            {canManageOnboarding ? (
              <Button asChild>
                <Link to="/onboarding/workspace">Open onboarding</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </ReadinessFrame>
    );
  }

  if (error || !onboarding) {
    return (
      <ReadinessFrame>
        <div className="w-full max-w-lg rounded-xl border bg-background p-6 shadow-sm sm:p-8">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Workspace readiness
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            Workspace is unavailable
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {authenticationError
              ? "Your sign-in session is missing or expired. Clear the local session and sign in again."
              : (error ??
                "The organization readiness response was incomplete.")}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.organization(),
                })
              }
            >
              Check again
            </Button>
            <Button type="button" onClick={() => void recoverClientSession()}>
              Log out / clear session
            </Button>
          </div>
        </div>
      </ReadinessFrame>
    );
  }

  if (onboarding.status !== OrganizationOnboardingStatus.Ready) {
    const initializing =
      onboarding.status === OrganizationOnboardingStatus.Initializing;
    const failed = onboarding.status === OrganizationOnboardingStatus.Failed;
    return (
      <ReadinessFrame>
        <div className="w-full max-w-lg rounded-xl border bg-background p-6 shadow-sm sm:p-8">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Workspace readiness
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            {initializing
              ? "Workspace setup is in progress"
              : failed
                ? "Workspace setup needs attention"
                : "Finish workspace setup"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {initializing
              ? "The Coordinator is bootstrapping organization context. Product surfaces will unlock after the control plane reports completion."
              : failed
                ? (onboarding.lastError ??
                  "The Coordinator could not complete bootstrap. Retry setup from onboarding.")
                : "Complete onboarding before using the dashboard, integrations, workflows, or organization administration."}
          </p>
          <div className="mt-4 flex items-center gap-2 text-sm">
            {initializing ? (
              <LoaderCircle
                className="size-4 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              <span
                className={
                  failed
                    ? "size-2 rounded-full bg-destructive"
                    : "size-2 rounded-full bg-amber-500"
                }
                aria-hidden="true"
              />
            )}
            <span className="text-muted-foreground">Workspace status:</span>
            <span className="font-medium">
              {initializing ? "Initializing" : failed ? "Failed" : "Pending"}
            </span>
          </div>
          {failed ? (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <span>Coordinator status: Failed</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-destructive/90">
                {onboarding.lastError ??
                  "The Coordinator reported a failure without a detailed error."}
              </p>
              <details className="mt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer">Execution details</summary>
                <dl className="mt-2 grid gap-1">
                  <div>
                    <dt className="inline font-medium text-foreground">
                      Organization ID:{" "}
                    </dt>
                    <dd className="inline break-all">
                      {onboarding.organizationId}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-foreground">
                      Coordinator ID:{" "}
                    </dt>
                    <dd className="inline break-all">
                      {onboarding.coordinatorId}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-foreground">
                      Last updated:{" "}
                    </dt>
                    <dd className="inline">
                      {new Date(onboarding.updatedAt).toLocaleString()}
                    </dd>
                  </div>
                </dl>
              </details>
            </div>
          ) : null}
          {resetOnboarding.isError ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              Reset failed: {resetOnboarding.error.message}
            </p>
          ) : null}
          {!canManageOnboarding && !initializing ? (
            <p className="mt-4 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              Ask your organization administrator to complete setup.
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isCheckingStatus}
              onClick={() =>
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.organization(),
                })
              }
            >
              {isCheckingStatus ? (
                <LoaderCircle
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : null}
              {initializing
                ? isCheckingStatus
                  ? "Checking status…"
                  : "Check status"
                : isCheckingStatus
                  ? "Refreshing…"
                  : "Refresh status"}
            </Button>
            {canManageOnboarding && failed ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => resetOnboarding.mutate()}
                disabled={resetOnboarding.isPending}
              >
                <RotateCcw
                  className={
                    resetOnboarding.isPending ? "animate-spin" : undefined
                  }
                  data-icon="inline-start"
                />
                {resetOnboarding.isPending
                  ? "Clearing setup…"
                  : "Clear all and try again"}
              </Button>
            ) : null}
            {canManageOnboarding && !initializing ? (
              <Button asChild>
                <Link to="/onboarding/workspace">Open onboarding</Link>
              </Button>
            ) : null}
            {failed && branding.supportUrl ? (
              <Button variant="ghost" asChild>
                <a href={branding.supportUrl} target="_blank" rel="noreferrer">
                  Contact support
                  <ExternalLink data-icon="inline-end" />
                </a>
              </Button>
            ) : null}
          </div>
          {failed && !branding.supportUrl ? (
            <p className="mt-3 text-xs text-muted-foreground">
              If retry still fails, contact your support team and include the
              execution details above.
            </p>
          ) : null}
        </div>
      </ReadinessFrame>
    );
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function ReadinessFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-12">
      {children}
    </div>
  );
}
