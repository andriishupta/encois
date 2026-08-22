import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

const items = [
  { label: 'Runs', to: '/workflows' as const },
  { label: 'Templates', to: '/workflows/templates' as const },
  { label: 'Blueprints', to: '/workflows/blueprints' as const },
]

export function WorkflowSurfaceNav() {
  return <nav aria-label="Workflow surfaces" className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/30 p-1 text-sm">{items.map((item) => <Link key={item.to} to={item.to} activeProps={{ className: 'bg-background text-foreground shadow-sm' }} className={cn('rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground')}>{item.label}</Link>)}</nav>
}
