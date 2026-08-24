import { Permission } from "@encois/contracts";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { Check, Circle, LogOut, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getAuthIdentity,
  getAuthSession,
  hasPermission,
  signOutFromIdentityPlatform,
} from "@/lib/auth";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: () => {
    if (!getAuthSession()) throw redirect({ to: "/login" });
  },
  component: OnboardingLayout,
});

const steps = [
  { label: "Workspace", to: "/onboarding/workspace" },
  { label: "Organization memory", to: "/onboarding/memory" },
  { label: "Coordinator", to: "/onboarding/coordination" },
  { label: "Workflows", to: "/onboarding/workflows" },
] as const;

function OnboardingLayout() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const currentStep = Math.max(
    0,
    steps.findIndex((step) => pathname === step.to),
  );
  const canOnboard = hasPermission(
    getAuthSession(),
    Permission.OnboardingManage,
  );

  if (!canOnboard) {
    return <OnboardingAccessDenied />;
  }

  return (
    <div className="min-h-svh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            to="/onboarding/workspace"
            className="flex items-center gap-2 font-semibold"
          >
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Activity className="size-4" aria-hidden="true" />
            </span>
            Workspace
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-right text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Workspace setup</p>
              <p>
                Step {currentStep + 1} of {steps.length}
              </p>
            </div>
            <OnboardingAccountActions />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <div className="mx-auto mb-10 max-w-3xl">
          <div className="flex items-start justify-between">
            {steps.map((step, index) => {
              const completed = index < currentStep;
              const active = index === currentStep;
              return (
                <div
                  key={step.to}
                  className="flex flex-1 items-start last:flex-none"
                >
                  <div className="flex flex-col items-center gap-2">
                    <span
                      className={`flex size-8 items-center justify-center rounded-full border text-xs font-medium ${completed ? "border-primary bg-primary text-primary-foreground" : active ? "border-primary text-primary" : "border-border bg-background text-muted-foreground"}`}
                    >
                      {completed ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : active ? (
                        <span className="size-2 rounded-full bg-primary" />
                      ) : (
                        <Circle className="size-3.5" aria-hidden="true" />
                      )}
                    </span>
                    <span
                      className={`hidden text-xs sm:block ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}
                    >
                      {step.label}
                    </span>
                  </div>
                  {index < steps.length - 1 ? (
                    <div
                      className={`mt-4 h-px flex-1 ${index < currentStep ? "bg-primary" : "bg-border"}`}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}

function OnboardingAccountActions() {
  const navigate = useNavigate();
  const identity = getAuthIdentity();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await signOutFromIdentityPlatform();
    } catch {
      // The local session is cleared in signOutFromIdentityPlatform's finally block.
    } finally {
      await navigate({ to: "/login" });
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="hidden min-w-0 text-right text-xs text-muted-foreground sm:block">
        <p className="max-w-44 truncate font-medium text-foreground">
          {identity.displayName ?? "Signed in account"}
        </p>
        <p className="max-w-44 truncate">
          {identity.email ?? "Development session"}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isSigningOut}
        onClick={() => void handleSignOut()}
      >
        <LogOut data-icon="inline-start" />
        <span className="hidden sm:inline">
          {isSigningOut ? "Signing out…" : "Sign out"}
        </span>
        <span className="sr-only sm:hidden">
          {isSigningOut ? "Signing out" : "Sign out"}
        </span>
      </Button>
    </div>
  );
}

function OnboardingAccessDenied() {
  return (
    <div className="min-h-svh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            to="/onboarding/workspace"
            className="flex items-center gap-2 font-semibold"
          >
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Activity className="size-4" aria-hidden="true" />
            </span>
            Workspace
          </Link>
          <OnboardingAccountActions />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="w-full rounded-xl border bg-background p-6 shadow-sm sm:p-8">
          <ShieldAlert
            className="size-8 text-muted-foreground"
            aria-hidden="true"
          />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            Onboarding is reserved for the workspace owner
          </h1>
          <p className="mt-3 text-muted-foreground">
            Please ask your organization administrator to complete workspace
            onboarding. Product surfaces stay locked until setup is complete.
          </p>
        </div>
      </main>
    </div>
  );
}
