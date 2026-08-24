import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Search, Sparkles } from 'lucide-react'
import type { WorkflowTemplateProjection } from '@encois/contracts'
import { Permission } from '@encois/contracts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { listWorkflowTemplates } from '@/lib/api'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { queryKeys } from '@/lib/query-keys'
import { AvailabilityBadge, unavailableCardClassName } from '@/components/availability-state'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/workflows/templates')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.WorkflowsRead)) throw redirect({ to: '/forbidden' })
  },
  component: WorkflowTemplatesPage,
})

function WorkflowTemplatesPage() {
  const [query, setQuery] = useState('')
  const templates = useQuery({ queryKey: queryKeys.workflowTemplates(query), queryFn: () => listWorkflowTemplates({ query }), staleTime: 60_000 })

  return <div className="flex flex-col gap-8">
    <PageHeader title="Workflow templates" description="Provider-neutral patterns that can be resolved into an independent Blueprint. Active templates can be used now; disabled templates remain visible but cannot be used." />
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search templates by name, purpose, or provider…" aria-label="Search workflow templates" className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50" /></div>
        <span className="text-xs text-muted-foreground">{templates.data?.length ?? 0} visible templates</span>
      </CardContent>
    </Card>
    {templates.isLoading ? <p className="text-sm text-muted-foreground">Loading templates…</p> : null}
    {templates.isError ? <Card><CardContent className="pt-6"><p role="alert" className="text-sm text-destructive">Could not load templates: {templates.error.message}</p></CardContent></Card> : null}
    {templates.data?.length ? <div className="grid gap-4 md:grid-cols-2">{templates.data.map((template) => <TemplateCard key={template.id} template={template} />)}</div> : null}
    {!templates.isLoading && !templates.isError && !templates.data?.length ? <Card><CardContent className="pt-6"><EmptyPanel icon={Sparkles} title="No templates match" description="Try another search or ask an administrator to add a reviewed template." /></CardContent></Card> : null}
  </div>
}

function TemplateCard({ template }: { template: WorkflowTemplateProjection }) {
  const disabled = template.status !== 'active'
  return <Card className={cn('flex h-full flex-col', disabled && unavailableCardClassName)}><CardHeader><div className="flex items-start justify-between gap-3"><CardTitle>{template.title}</CardTitle>{disabled ? <AvailabilityBadge label="Disabled" /> : null}</div><CardDescription>{template.category} · v{template.version}</CardDescription></CardHeader><CardContent className="flex flex-1 flex-col gap-4"><p className="text-sm text-muted-foreground">{template.description}</p><div className="flex flex-wrap gap-1.5">{template.requiredCapabilities.map((capability) => <span key={capability} className="rounded-full bg-secondary px-2 py-1 text-[11px] text-secondary-foreground">{capability}</span>)}</div><div className="mt-auto grid gap-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground"><p><span className="font-medium text-foreground">Provider slots:</span> {template.template.providerSlots.length || 'None'}</p><p><span className="font-medium text-foreground">Steps:</span> {template.template.steps.length} · <span className="font-medium text-foreground">Output:</span> {template.template.output.type}</p><p><span className="font-medium text-foreground">Estimated duration:</span> Not reported by Template</p><p><span className="font-medium text-foreground">Risk:</span> Review approval requirements in the plan preview</p></div>{disabled ? <Button variant="outline" disabled>Disabled</Button> : <Button variant="outline" asChild><Link to="/workflows/new" search={{ template: template.key }}>Use in workflow creation</Link></Button>}</CardContent></Card>
}
