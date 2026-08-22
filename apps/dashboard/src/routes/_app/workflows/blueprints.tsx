import { createFileRoute, Link, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { FilePlus2, GitBranch, Search } from 'lucide-react'
import { useState } from 'react'
import type { WorkflowBlueprintProjection, WorkflowBlueprintStatus } from '@encois/contracts'
import { Permission } from '@encois/contracts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { WorkflowSurfaceNav } from '@/components/workflow-surface-nav'
import { listWorkflowBlueprints } from '@/lib/api'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { queryKeys } from '@/lib/query-keys'
import { formatDate } from '@/lib/formatters'

export const Route = createFileRoute('/_app/workflows/blueprints')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.WorkflowsRead)) throw redirect({ to: '/forbidden' })
  },
  component: WorkflowBlueprintsPage,
})

function WorkflowBlueprintsPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  if (pathname !== '/workflows/blueprints') return <Outlet />

  const blueprints = useQuery({ queryKey: queryKeys.workflowBlueprints(), queryFn: listWorkflowBlueprints, staleTime: 30_000 })
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<WorkflowBlueprintStatus | 'all'>('all')
  const filteredBlueprints = (blueprints.data ?? []).filter((blueprint) => {
    const normalizedQuery = query.trim().toLowerCase()
    return (status === 'all' || blueprint.status === status) && (!normalizedQuery || [blueprint.name, blueprint.purpose, blueprint.blueprintId].some((value) => value.toLowerCase().includes(normalizedQuery)))
  })

  return <div className="flex flex-col gap-8">
    <PageHeader title="Workflow Blueprints" description="Immutable, organization-scoped execution definitions. A Run is created from a Blueprint snapshot; changing one never rewrites an existing Run." actions={<Button asChild><Link to="/workflows/new"><FilePlus2 data-icon="inline-start" />Create workflow</Link></Button>} />
    <WorkflowSurfaceNav />
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Blueprints by name or purpose…" aria-label="Search workflow Blueprints" className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50" /></div>
        <select value={status} onChange={(event) => setStatus(event.target.value as WorkflowBlueprintStatus | 'all')} aria-label="Filter Blueprints by lifecycle status" className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><option value="all">All statuses</option><option value="draft">Draft</option><option value="approved">Published / approved</option><option value="retired">Archived / retired</option></select>
        <span className="text-xs text-muted-foreground">{filteredBlueprints.length} visible Blueprints</span>
      </CardContent>
    </Card>
    {blueprints.isLoading ? <p className="text-sm text-muted-foreground">Loading Blueprints…</p> : null}
    {blueprints.isError ? <Card><CardContent className="pt-6 text-sm text-destructive">Could not load Blueprints: {blueprints.error.message}</CardContent></Card> : null}
    {filteredBlueprints.length ? <div className="grid gap-4 md:grid-cols-2">{filteredBlueprints.map((blueprint) => <BlueprintCard key={`${blueprint.blueprintId}:${blueprint.version}`} blueprint={blueprint} />)}</div> : null}
    {!blueprints.isLoading && !blueprints.isError && blueprints.data?.length && !filteredBlueprints.length ? <Card><CardContent className="pt-6"><EmptyPanel icon={Search} title="No Blueprints match" description="Change the search or lifecycle filter." /></CardContent></Card> : null}
    {!blueprints.isLoading && !blueprints.isError && !blueprints.data?.length ? <Card><CardContent className="pt-6"><EmptyPanel icon={GitBranch} title="No Blueprints" description={<>Create one from a published <ProductTerm term="template" /> and submit it through the approval boundary.</>} /></CardContent></Card> : null}
  </div>
}

function BlueprintCard({ blueprint }: { blueprint: WorkflowBlueprintProjection }) {
  return <Card className="flex h-full flex-col"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{blueprint.name}</CardTitle><CardDescription>v{blueprint.version} · {blueprint.status}{blueprint.isCurrent ? ' · current' : ''}</CardDescription></div><GitBranch className="size-4 text-muted-foreground" aria-hidden="true" /></div></CardHeader><CardContent className="flex flex-1 flex-col gap-4"><p className="text-sm text-muted-foreground">{blueprint.purpose}</p><div className="mt-auto grid gap-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground"><p><span className="font-medium text-foreground">Steps:</span> {blueprint.steps.length} · <span className="font-medium text-foreground">Approval:</span> {blueprint.requiresApproval ? 'required' : 'not required'}</p><p><span className="font-medium text-foreground">Updated:</span> {formatDate(blueprint.updatedAt)}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link to="/workflows/blueprints/$blueprintId" params={{ blueprintId: blueprint.blueprintId }}>Review revisions</Link></Button>{blueprint.status === 'approved' && blueprint.isCurrent ? <Button variant="outline" asChild><Link to="/workflows/new" search={{ blueprint: blueprint.blueprintId }}>Use as workflow source</Link></Button> : null}</div></CardContent></Card>
}
