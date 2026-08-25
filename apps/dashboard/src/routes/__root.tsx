import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createRootRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { AppErrorPage } from "@/components/app-error-boundary";
import { StatusPage } from "@/components/status-page";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getOrganization } from "@/lib/api";
import { authSessionEventName, getAuthSession } from "@/lib/auth";
import { getBranding, getPublicWorkspaceTitle } from "@/lib/branding";
import { queryKeys } from "@/lib/query-keys";

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: ({ error, reset }) => (
    <AppErrorPage error={error} onRetry={reset} />
  ),
  notFoundComponent: () => <StatusPage code={404} />,
});

function RootLayout() {
  return (
    <>
      <DocumentTitle />
      <AuthSessionRedirector />
      <TooltipProvider>
        <Outlet />
      </TooltipProvider>
    </>
  );
}

function AuthSessionRedirector() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleSessionChange = () => {
      const publicPage =
        pathname === "/login" ||
        pathname === "/sign-up" ||
        pathname === "/waitlist";
      if (publicPage || getAuthSession()) return;
      queryClient.clear();
      window.location.replace("/login");
    };
    window.addEventListener(authSessionEventName(), handleSessionChange);
    return () =>
      window.removeEventListener(authSessionEventName(), handleSessionChange);
  }, [pathname, queryClient]);

  return null;
}

function DocumentTitle() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const organization = useQuery({
    queryKey: queryKeys.organization(),
    queryFn: getOrganization,
    enabled: Boolean(getAuthSession()),
  });
  const organizationName = organization.data?.organization.name;
  const branding = getBranding(organizationName);
  const productName = branding.productName;
  const workspaceName = organizationName ? branding.workspaceName : undefined;

  useEffect(() => {
    const pageTitle = getPageTitle(pathname, productName);
    const publicPage =
      pathname === "/login" ||
      pathname === "/sign-up" ||
      pathname === "/waitlist";
    document.title =
      !publicPage && workspaceName
        ? `${pageTitle} | ${workspaceName}`
        : pageTitle;
  }, [pathname, productName, workspaceName]);

  return null;
}

function getPageTitle(pathname: string, productName: string) {
  if (pathname === "/") return "Dashboard";
  if (pathname === "/login") return getPublicWorkspaceTitle();
  if (pathname === "/sign-up" || pathname === "/waitlist")
    return "Join the waitlist";
  if (pathname === "/workflows") return "Workflows";
  if (pathname === "/workflows/runs") return "Workflow runs";
  if (pathname === "/workflows/plans") return "Workflow plans";
  if (pathname.startsWith("/workflows/plans/")) return "Workflow plan";
  if (pathname === "/workflows/new") return "New workflow";
  if (pathname === "/workflows/templates") return "Workflow templates";
  if (pathname === "/workflows/blueprints") return "Workflow Blueprints";
  if (pathname.startsWith("/workflows/blueprints/"))
    return "Blueprint revision";
  if (pathname.startsWith("/workflows/definitions/"))
    return "Workflow definition";
  if (pathname === "/workflows/memory") return "Workflow memory";
  if (pathname.startsWith("/workflows/")) return "Workflow execution";
  if (pathname === "/organization/sources") return "Knowledge sources";
  if (pathname === "/organization/sources/new") return "Add Source";
  if (pathname === "/organization/units/new") return "Add organization unit";
  if (pathname.startsWith("/organization/sources/")) return "Knowledge source";
  if (pathname === "/organization/integrations") return "Integrations";
  if (pathname === "/organization/integrations/new") return "Add integration";
  if (pathname.startsWith("/organization/integrations/"))
    return getIntegrationTitle(pathname);
  if (pathname === "/activity") return "Activity";
  if (pathname === "/organization/memory") return "Organization memory graph";
  if (pathname === "/organization/investigations") return "Investigations";
  if (pathname === "/organization") return "Organization";
  if (pathname === "/organization/members") return "Organization members";
  if (pathname === "/organization/permissions")
    return "Organization permissions";
  if (pathname === "/settings") return "Settings";
  if (pathname === "/settings/workspace") return "Workspace settings";
  if (pathname === "/settings/notifications") return "Notifications";
  if (pathname === "/settings/documentation")
    return `${productName} Documentation`;
  if (pathname === "/organization/access") return "Organization access";
  if (pathname === "/profile") return "Account";
  if (pathname === "/forbidden") return "Access denied";
  return "Page not found";
}

function getIntegrationTitle(pathname: string) {
  const id = pathname.split("/").pop();
  if (id === "github") return "GitHub integration";
  if (id === "jira") return "Jira integration";
  return "Integration";
}
