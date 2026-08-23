import { useMemo, useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BrainCircuit, CircleAlert, ShieldCheck } from 'lucide-react'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { applyMemoryChange, approveMemoryChange, createMemoryChange, isApiError, listMemoryChanges, queryAgentMemory, rejectMemoryChange } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { useOrganization } from '@/lib/organization-context'
import { Permission } from '@encois/contracts'
import { formatDate, humanizeKey } from '@/lib/formatters'
import { formatUnitPath } from '@/lib/organization'
import { usePermissions } from '@/lib/permissions'
import { ProductTerm } from '@/components/product-term'

export const Route = createFileRoute('/_app/workflows/memory')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.MemoryRead)) throw redirect({ to: '/forbidden' })
  },
  component: MemoryPage,
})

const agentDefinitions = ['context.synthesizer@1', 'release-investigation.synthesizer@1', 'source-ingestion'] as const

function MemoryPage() {
  const { units } = useOrganization()
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const canManageMemory = can(Permission.MemoryManage)
  const [agentDefinition, setAgentDefinition] = useState<string>(agentDefinitions[0])
  const [query, setQuery] = useState('release context')
  const [projectId, setProjectId] = useState('')
  const [scope, setScope] = useState('all')
  const selectedScope = scope === 'all' ? undefined : { ids: [scope] }
  const memory = useQuery({
    queryKey: queryKeys.agentMemory(agentDefinition, query, scope, projectId),
    queryFn: () => queryAgentMemory({ agentDefinition, query, maxResults: 20, ...(projectId.trim() ? { projectId: projectId.trim() } : {}), ...(selectedScope ? { scope: selectedScope } : {}) }),
    enabled: query.trim().length > 0,
  })
  const changes = useQuery({ queryKey: queryKeys.memoryChanges(), queryFn: () => listMemoryChanges(), enabled: canManageMemory, refetchInterval: 15_000 })
  const [changeError, setChangeError] = useState<string | null>(null)
  const [newSummary, setNewSummary] = useState('')
  const [newEvidenceRefs, setNewEvidenceRefs] = useState('')
  const requestChange = useMutation({
    mutationFn: createMemoryChange,
    onSuccess: () => {
      setChangeError(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.memoryChanges() })
    },
    onError: (error) => setChangeError(error.message),
  })
  const scopeLabel = scope === 'all' ? 'All available units' : formatUnitPath(units, scope) || scope
  const governanceScope = useMemo(() => memory.data?.scope ?? selectedScope ?? { ids: units.filter((unit) => unit.canView && unit.id !== 'organization').map((unit) => unit.id) }, [memory.data?.scope, selectedScope, units])

  function submitAddMemory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const evidenceRefs = [...new Set(newEvidenceRefs.split(/\r?\n/gu).map((value) => value.trim()).filter(Boolean))]
    if (!newSummary.trim() || evidenceRefs.length === 0) return
    requestChange.mutate({ agentDefinition, projectId: projectId.trim() || undefined, scope: governanceScope, action: 'add', replacementSummary: newSummary.trim(), evidenceRefs }, {
      onSuccess: () => { setNewSummary(''); setNewEvidenceRefs('') },
    })
  }

  return <div className="flex flex-col gap-8">
    <PageHeader title="Workflow memory" description={<>Review scoped distilled context available to authorized workflows. Retrieval is read-only; changes are proposed, approved, audited, and then applied through the runtime to <ProductTerm term="memoryBank" />.</>} actions={<span className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" />Restricted surface</span>} />
    <div className="flex items-start gap-3 rounded-lg border bg-background px-4 py-3 text-sm"><BrainCircuit className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><p className="text-muted-foreground"><span className="font-medium text-foreground">Scoped memory boundary.</span> The dashboard can inspect only the selected workflow context and organization scope. It never mutates provider memory directly; authorized managers create an auditable change proposal.</p></div>
    <Card>
      <CardHeader><CardTitle>Search memory</CardTitle><CardDescription>Choose a scoped workflow context and search it with a bounded <ProductTerm term="query" />.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-2 md:items-end xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium"><ProductTerm term="agentDefinition" /><select value={agentDefinition} onChange={(event) => setAgentDefinition(event.target.value)} className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm font-normal">{agentDefinitions.map((definition) => <option key={definition} value={definition}>{definition}</option>)}</select></label>
          <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium">Search query<input value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm font-normal" maxLength={2000} /></label>
          <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium">Project filter<input value={projectId} onChange={(event) => setProjectId(event.target.value)} placeholder="Optional project id" className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm font-normal" maxLength={160} /></label>
          <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium">Scope<select value={scope} onChange={(event) => setScope(event.target.value)} className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm font-normal"><option value="all">All available units</option>{units.filter((unit) => unit.canView && unit.id !== 'organization').map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
        </div>
        {memory.isLoading ? <p className="text-sm text-muted-foreground">Retrieving scoped memory…</p> : null}
        {memory.isError ? <EmptyPanel icon={CircleAlert} title={isApiError(memory.error) && memory.error.code === 'MEMORY_UNAVAILABLE' ? 'Memory unavailable' : 'Memory search failed'} description={memory.error.message} /> : null}
        {memory.data ? <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4"><MemoryMeta label="Agent" value={humanizeKey(memory.data.agentDefinition.replace(/\./gu, ' '))} /><MemoryMeta label="Scope" value={scopeLabel} /><MemoryMeta label="Matches" value={String(memory.data.memories.length)} /><MemoryMeta label="Generated" value={formatDate(memory.data.generatedAt)} /></div> : null}
        {memory.data && memory.data.memories.length === 0 ? <EmptyPanel icon={BrainCircuit} title="No memories found" description="The selected agent definition has no matching memory in the current scope." /> : null}
        {changeError ? <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Could not submit the memory change: {changeError}</p> : null}
        {memory.data && memory.data.memories.length > 0 ? <div className="grid gap-3 lg:grid-cols-2">{memory.data.memories.map((record) => <MemoryRecordCard key={record.id} record={record} scopeLabel={scopeLabel} status={memory.data?.status ?? 'completed'} canManage={canManageMemory} busy={requestChange.isPending} onRequest={(input) => requestChange.mutate({ ...input, scope: memory.data?.scope ?? selectedScope ?? { ids: [] } })} />)}</div> : null}
      </CardContent>
    </Card>
    {canManageMemory ? <Card><CardHeader><CardTitle>Add workflow memory</CardTitle><CardDescription>Create a new evidence-linked memory proposal. It is redacted, reviewed, and only then applied to workflow memory.</CardDescription></CardHeader><CardContent><form className="flex flex-col gap-4" onSubmit={submitAddMemory}><div className="grid gap-3 sm:grid-cols-2"><label className="flex flex-col gap-1.5 text-xs font-medium">Agent definition<input value={agentDefinition} readOnly className="h-9 rounded-md border bg-muted/30 px-3 text-sm font-normal" /></label><label className="flex flex-col gap-1.5 text-xs font-medium">Project scope<input value={projectId} onChange={(event) => setProjectId(event.target.value)} placeholder="Optional project id" maxLength={160} className="h-9 rounded-md border bg-background px-3 text-sm font-normal" /></label></div><label className="flex flex-col gap-1.5 text-xs font-medium">Memory fact<textarea value={newSummary} onChange={(event) => setNewSummary(event.target.value)} minLength={1} maxLength={10000} rows={4} placeholder="Write the evidence-backed fact to remember…" className="rounded-md border bg-background p-2 text-sm font-normal" required /></label><label className="flex flex-col gap-1.5 text-xs font-medium">Evidence references <span className="font-normal text-muted-foreground">One reference per line</span><textarea value={newEvidenceRefs} onChange={(event) => setNewEvidenceRefs(event.target.value)} rows={3} placeholder="source:source-id:revision-id" className="rounded-md border bg-background p-2 text-sm font-normal" required /></label>{changeError ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Could not submit the memory change: {changeError}</p> : null}<div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Scope: {scopeLabel}. Approval and apply remain separate actions.</p><Button type="submit" disabled={requestChange.isPending || !newSummary.trim() || !newEvidenceRefs.trim()}>{requestChange.isPending ? 'Submitting…' : 'Propose memory'}</Button></div></form></CardContent></Card> : null}
    {canManageMemory ? <Card><CardHeader><CardTitle>Memory governance</CardTitle><CardDescription>Pending and completed add, correction, or deletion proposals for the current organization.</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">{changes.isLoading ? <p className="text-sm text-muted-foreground">Loading memory changes…</p> : changes.isError ? <p role="alert" className="text-sm text-destructive">Could not load memory changes: {changes.error.message}</p> : changes.data?.length ? changes.data.map((change) => <div key={change.id} className="flex flex-col gap-1 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{change.action === 'add' ? 'Addition' : change.action === 'correct' ? 'Correction' : 'Deletion'} · {humanizeKey(change.agentDefinition.replace(/\./gu, ' '))}</p><p className="text-xs text-muted-foreground">{humanizeKey(change.status)} · {formatDate(change.updatedAt)}</p></div><span className="text-xs text-muted-foreground">{change.status === 'applied' ? 'Provider updated' : 'Review in Approval queue'}</span></div>) : <p className="text-sm text-muted-foreground">No memory change proposals yet.</p>}</CardContent></Card> : null}
  </div>
}

function MemoryMeta({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-medium" title={value}>{value}</p></div>
}

function MemoryRecordCard({ record, scopeLabel, status, canManage, busy, onRequest }: { record: import('@encois/contracts').AgentMemoryRecord; scopeLabel: string; status: string; canManage: boolean; busy: boolean; onRequest: (input: { memoryId: string; agentDefinition: string; projectId?: string; userId?: string; action: 'correct' | 'delete'; replacementSummary?: string }) => void }) {
  const [replacementSummary, setReplacementSummary] = useState('')
  const [correcting, setCorrecting] = useState(false)
  const freshness = record.freshness
  const freshnessValue = freshness
    ? `${humanizeKey(freshness.status)} · ${freshness.source}${freshness.expiresAt ? ` · expires ${formatDate(freshness.expiresAt)}` : ''}`
    : 'Not reported'
  const retentionValue = record.retentionUntil ? `${record.retentionClass ? humanizeKey(record.retentionClass) : 'Retention'} · until ${formatDate(record.retentionUntil)}` : record.retentionClass ? humanizeKey(record.retentionClass) : 'Not reported'

  return <article className="rounded-lg border p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium">{humanizeKey(record.agentDefinition.replace(/\./gu, ' '))}</p><p className="mt-1 text-xs text-muted-foreground">Observed {formatDate(record.observedAt)} · {scopeLabel}</p></div><span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-[11px] text-secondary-foreground">{humanizeKey(status)}</span></div><p className="mt-4 text-sm leading-6">{record.summary}</p><dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-muted-foreground">Freshness</dt><dd>{freshnessValue}</dd></div><div><dt className="text-muted-foreground">Retention</dt><dd>{retentionValue}</dd></div><div><dt className="text-muted-foreground">Ingested</dt><dd>{freshness?.ingestedAt ? formatDate(freshness.ingestedAt) : 'Not reported'}</dd></div><div><dt className="text-muted-foreground">Agent linkage</dt><dd>{record.agentDefinition}</dd></div>{record.projectId ? <div><dt className="text-muted-foreground">Project scope</dt><dd>{record.projectId}</dd></div> : null}</dl>{record.evidenceRefs.length ? <details className="mt-4 rounded-md border bg-muted/20 px-3 py-2 text-xs"><summary className="cursor-pointer font-medium">Evidence references ({record.evidenceRefs.length})</summary><div className="mt-2 flex flex-wrap gap-1.5">{record.evidenceRefs.map((ref) => <code key={ref} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{ref}</code>)}</div></details> : null}<details className="mt-2 rounded-md border bg-muted/20 px-3 py-2 text-xs"><summary className="cursor-pointer font-medium">Technical identifiers</summary><div className="mt-2 flex flex-col gap-1 font-mono text-muted-foreground"><span>Memory: {record.id}</span>{record.workflowId ? <span>Workflow: {record.workflowId}</span> : null}{record.runId ? <span>Run: {record.runId}</span> : null}</div></details>{canManage ? <div className="mt-4 flex flex-wrap gap-2 border-t pt-3"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setCorrecting((value) => !value)}>Request correction</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm('Submit a deletion proposal for this memory?')) onRequest({ memoryId: record.id, agentDefinition: record.agentDefinition, projectId: record.projectId, userId: record.userId, action: 'delete' }) }}>Request deletion</Button></div> : null}{correcting ? <div className="mt-3 flex flex-col gap-2 rounded-md border bg-muted/20 p-3"><label className="text-xs font-medium">Replacement fact<textarea value={replacementSummary} onChange={(event) => setReplacementSummary(event.target.value)} className="mt-1 min-h-24 w-full rounded-md border bg-background p-2 text-sm font-normal" maxLength={10000} placeholder="Write the corrected memory fact…" /></label><div className="flex gap-2"><Button type="button" size="sm" disabled={busy || !replacementSummary.trim()} onClick={() => { onRequest({ memoryId: record.id, agentDefinition: record.agentDefinition, projectId: record.projectId, userId: record.userId, action: 'correct', replacementSummary: replacementSummary.trim() }); setCorrecting(false); setReplacementSummary('') }}>Submit proposal</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setCorrecting(false)}>Cancel</Button></div></div> : null}</article>
}
