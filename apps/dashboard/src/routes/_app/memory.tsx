import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { BrainCircuit, CircleAlert, ShieldCheck } from 'lucide-react'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { isApiError, queryAgentMemory } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { useOrganization } from '@/lib/organization-context'
import { Permission } from '@encois/contracts'
import { formatDate } from '@/lib/formatters'

export const Route = createFileRoute('/_app/memory')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.MemoryRead)) throw redirect({ to: '/forbidden' })
  },
  component: MemoryPage,
})

const agentDefinitions = ['context.synthesizer@1', 'release-investigation.synthesizer@1', 'source-ingestion'] as const

function MemoryPage() {
  const { units } = useOrganization()
  const [agentDefinition, setAgentDefinition] = useState<string>(agentDefinitions[0])
  const [query, setQuery] = useState('release context')
  const [projectId, setProjectId] = useState('')
  const [scope, setScope] = useState('all')
  const selectedScope = scope === 'all' ? undefined : { ids: [scope] }
  const memory = useQuery({
    queryKey: queryKeys.agentMemory(agentDefinition, query, scope, projectId),
    queryFn: () => queryAgentMemory({ agentDefinition, query, maxResults: 20, ...(projectId.trim() ? { projectId: projectId.trim() } : {}), ...(selectedScope ? { scope: selectedScope } : {}) }),
    enabled: query.trim().length > 0,
    retry: false,
  })

  return <div className="flex flex-col gap-8">
    <PageHeader title="Memory" description="Review scoped distilled context available to authorized workflows. Retrieval is read-only and visibility remains permission-bound." actions={<span className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" />Restricted surface</span>} />
    <div className="flex items-start gap-3 rounded-lg border bg-background px-4 py-3 text-sm"><BrainCircuit className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><p className="text-muted-foreground"><span className="font-medium text-foreground">Scoped memory boundary.</span> The dashboard can inspect only the selected workflow context and organization scope. It cannot write, delete, or broaden memory visibility.</p></div>
    <Card>
      <CardHeader><CardTitle>Search memory</CardTitle><CardDescription>Choose a scoped workflow context and search it with a bounded query.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:items-end">
          <label className="flex flex-col gap-1.5 text-xs font-medium">Agent definition<select value={agentDefinition} onChange={(event) => setAgentDefinition(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm font-normal">{agentDefinitions.map((definition) => <option key={definition} value={definition}>{definition}</option>)}</select></label>
          <label className="flex flex-col gap-1.5 text-xs font-medium">Search query<input value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm font-normal" maxLength={2000} /></label>
          <label className="flex flex-col gap-1.5 text-xs font-medium">Project filter<input value={projectId} onChange={(event) => setProjectId(event.target.value)} placeholder="Optional project id" className="h-9 rounded-md border bg-background px-3 text-sm font-normal" maxLength={160} /></label>
          <label className="flex flex-col gap-1.5 text-xs font-medium">Scope<select value={scope} onChange={(event) => setScope(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm font-normal"><option value="all">All available units</option>{units.filter((unit) => unit.id !== 'organization').map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
          <Button type="button" variant="outline" onClick={() => void memory.refetch()} disabled={memory.isFetching || !query.trim()}>Refresh</Button>
        </div>
        {memory.isLoading ? <p className="text-sm text-muted-foreground">Retrieving scoped memory…</p> : null}
        {memory.isError ? <EmptyPanel icon={CircleAlert} title={isApiError(memory.error) && memory.error.code === 'MEMORY_UNAVAILABLE' ? 'Memory unavailable' : 'Memory search failed'} description={memory.error.message} action={<Button type="button" variant="outline" onClick={() => void memory.refetch()}>Try again</Button>} /> : null}
        {memory.data && memory.data.memories.length === 0 ? <EmptyPanel icon={BrainCircuit} title="No memories found" description="The selected agent definition has no matching memory in the current scope." /> : null}
        {memory.data && memory.data.memories.length > 0 ? <div className="grid gap-3 lg:grid-cols-2">{memory.data.memories.map((record) => <article key={record.id} className="rounded-lg border p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{record.agentDefinition}</p><p className="mt-1 text-xs text-muted-foreground">Observed {formatDate(record.observedAt)}</p></div><span className="rounded-full bg-secondary px-2 py-1 text-[11px] text-secondary-foreground">{memory.data?.status}</span></div><p className="mt-4 text-sm leading-6">{record.summary}</p><dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-muted-foreground">Freshness</dt><dd>{record.freshness ? `${record.freshness.status} · observed ${formatDate(record.freshness.observedAt)}` : 'Not reported'}</dd></div><div><dt className="text-muted-foreground">Run linkage</dt><dd>{record.runId ?? record.workflowId ?? 'Not reported'}</dd></div><div><dt className="text-muted-foreground">Retention</dt><dd>{record.retentionUntil ? `${record.retentionClass ?? 'retention'} · until ${formatDate(record.retentionUntil)}` : record.retentionClass ?? 'Not reported'}</dd></div></dl>{record.evidenceRefs.length ? <div className="mt-4 flex flex-wrap gap-1.5">{record.evidenceRefs.map((ref) => <code key={ref} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{ref}</code>)}</div> : null}</article>)}</div> : null}
      </CardContent>
    </Card>
  </div>
}
