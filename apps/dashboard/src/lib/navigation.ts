export type NavigationTarget =
  | "/"
  | "/workflows"
  | "/workflows/runs"
  | "/workflows/templates"
  | "/workflows/blueprints"
  | "/workflows/plans"
  | "/workflows/memory"
  | "/organization/memory"
  | "/organization/investigations"
  | "/organization/sources"
  | "/organization/integrations"
  | "/organization/integrations/catalog"
  | "/activity"
  | "/organization"
  | "/management/members"
  | "/management/members/$memberId"
  | "/management/access"
  | "/settings"
  | "/settings/workspace"
  | "/settings/notifications"
  | "/settings/documentation";

const workflowRunIdPath = /^\/workflows\/[^/]+$/u;
const workflowNonRunPaths = new Set([
  "/workflows/new",
  "/workflows/templates",
  "/workflows/blueprints",
  "/workflows/plans",
  "/workflows/memory",
]);

export function isNavigationItemActive(
  pathname: string,
  target: NavigationTarget,
): boolean {
  if (target === "/") return pathname === "/";
  if (target === "/workflows")
    return (
      pathname === "/workflows" ||
      pathname === "/workflows/new" ||
      pathname.startsWith("/workflows/definitions/")
    );
  if (target === "/workflows/runs") {
    return (
      pathname === "/workflows/runs" ||
      (workflowRunIdPath.test(pathname) &&
        !workflowNonRunPaths.has(pathname) &&
        !pathname.startsWith("/workflows/definitions/") &&
        !pathname.startsWith("/workflows/plans/"))
    );
  }
  if (
    target === "/workflows/blueprints" ||
    target === "/workflows/plans" ||
    target === "/workflows/templates"
  )
    return pathname === target || pathname.startsWith(`${target}/`);
  if (
    target === "/workflows/memory" ||
    target === "/organization/memory" ||
    target === "/organization/investigations" ||
    target === "/organization/sources"
  )
    return pathname === target || pathname.startsWith(`${target}/`);
  if (target === "/organization/integrations")
    return (
      (pathname === target || pathname.startsWith(`${target}/`)) &&
      pathname !== "/organization/integrations/catalog"
    );
  if (target === "/organization/integrations/catalog")
    return pathname === target || pathname.startsWith(`${target}/`);
  if (
    target === "/management/members" ||
    target === "/management/members/$memberId" ||
    target === "/management/access"
  )
    return pathname === target || pathname.startsWith(`${target}/`);
  return pathname === target;
}
