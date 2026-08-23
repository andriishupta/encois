export type NavigationTarget =
  | '/'
  | '/workflows'
  | '/workflows/runs'
  | '/workflows/templates'
  | '/workflows/blueprints'
  | '/workflows/memory'
  | '/organization/sources'
  | '/organization/integrations'
  | '/review'
  | '/organization'
  | '/organization/memory'
  | '/organization/investigations'
  | '/organization/permissions'
  | '/organization/access'
  | '/settings'
  | '/settings/workspace'
  | '/settings/notifications'

const workflowRunIdPath = /^\/workflows\/[^/]+$/u
const workflowNonRunPaths = new Set(['/workflows/new', '/workflows/templates', '/workflows/blueprints', '/workflows/memory'])

export function isNavigationItemActive(pathname: string, target: NavigationTarget): boolean {
  if (target === '/') return pathname === '/'
  if (target === '/workflows') return pathname === '/workflows' || pathname === '/workflows/new'
  if (target === '/workflows/runs') {
    return pathname === '/workflows/runs' || (workflowRunIdPath.test(pathname) && !workflowNonRunPaths.has(pathname))
  }
  if (target === '/workflows/blueprints') return pathname === target || pathname.startsWith(`${target}/`)
  if (target === '/workflows/memory' || target === '/organization/memory') return pathname === target
  if (target === '/organization/sources' || target === '/organization/integrations') return pathname === target || pathname.startsWith(`${target}/`)
  return pathname === target
}
