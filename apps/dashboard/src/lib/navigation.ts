export type NavigationTarget =
  | "/"
  | "/workflows"
  | "/workflows/runs"
  | "/workflows/templates"
  | "/workflows/blueprints"
  | "/memory/workflow"
  | "/memory/organization"
  | "/memory/investigations"
  | "/memory/sources"
  | "/organization/integrations"
  | "/activity"
  | "/organization"
  | "/management/members"
  | "/management/permissions"
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
  "/memory/workflow",
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
  if (target === "/workflows/blueprints" || target === "/workflows/plans")
    return pathname === target || pathname.startsWith(`${target}/`);
  if (
    target === "/memory/workflow" ||
    target === "/memory/organization" ||
    target === "/memory/investigations" ||
    target === "/memory/sources"
  )
    return pathname === target || pathname.startsWith(`${target}/`);
  if (target === "/organization/integrations")
    return pathname === target || pathname.startsWith(`${target}/`);
  if (
    target === "/management/members" ||
    target === "/management/permissions" ||
    target === "/management/access"
  )
    return pathname === target || pathname.startsWith(`${target}/`);
  return pathname === target;
}
