import { useState, type FormEvent, type ReactNode } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileText, LoaderCircle, Play, Plus, RefreshCw, Waypoints } from 'lucide-react'
import { SourceRevisionStatus, KnowledgeSourceKind, type SourceRevision } from '@encois/contracts'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createSourceRevision, getKnowledgeSource, isApiError, startSourceIngestion } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { Permission } from '@encois/contracts'
import { formatDate, humanizeKey } from '@/lib/formatters'

export const Route = createFileRoute('/_app/sources/$sourceId')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.KnowledgeRead)) throw redirect({ to: '/forbidden' })
  },
  component: SourceDetailPage,
})

function SourceDetailPage() {
  const { sourceId } = Route.useParams()
  const queryClient = useQueryClient()
  const source = useQuery({ queryKey: queryKeys.source(sourceId), queryFn: () => getKnowledgeSource(sourceId), refetchInterval: 30_000 })
  const [error, setError] = useState<string | null>(null)
  const [compareRevisionId, setCompareRevisionId] = useState<string>()
  const [revision, setRevision] = useState('')
  const [artifactRef, setArtifactRef] = useState('')
  const [sourceObjectId, setSourceObjectId] = useState('')
  const [contentType, setContentType] = useState('')
  const [checksum, setChecksum] = useState('')
  const [observedAt, setObservedAt] = useState('')
  const ingest = useMutation({
    mutationFn: (revisionId: string) => startSourceIngestion(sourceId, revisionId),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.source(sourceId) }); setError(null) },
    onError: (cause) => setError(isApiError(cause) ? cause.message : 'Ingestion could not be started.'),
  })
  const registerRevision = useMutation({
    mutationFn: () => createSourceRevision(sourceId, {
      revision: revision.trim(),
      ...(artifactRef.trim() ? { artifactRef: artifactRef.trim() } : {}),
      ...(sourceObjectId.trim() ? { sourceObjectId: sourceObjectId.trim() } : {}),
      ...(contentType.trim() ? { contentType: contentType.trim() } : {}),
      ...(checksum.trim() ? { checksum: checksum.trim() } : {}),
      ...(observedAt ? { observedAt: new Date(observedAt).toISOString() } : {}),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.source(sourceId) })
      setRevision('')
      setArtifactRef('')
      setSourceObjectId('')
      setContentType('')
      setChecksum('')
      setObservedAt('')
      setError(null)
    },
    onError: (cause) => setError(isApiError(cause) ? cause.message : 'The source revision could not be registered.'),
  })
  const canManageKnowledge = hasPermission(getAuthSession(), Permission.KnowledgeManage)

  function handleRegisterRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!revision.trim()) {
      setError('A revision identifier is required.')
      return
    }
    if (!artifactRef.trim() && !sourceObjectId.trim()) {
      setError('Provide an artifact reference or provider object ID so the revision can be acquired.')
      return
    }
    setError(null)
    registerRevision.mutate()
  }

  if (source.isLoading) return <p className="text-sm text-muted-foreground">Loading source…</p>
  if (source.isError) return <Card><CardContent className="pt-6"><p role="alert" className="text-sm text-destructive">Could not load source: {source.error.message}</p></CardContent></Card>
  if (!source.data) return <Card><CardContent className="pt-6"><EmptyPanel icon={Waypoints} title="Source not found" description="This source is not visible in the current organization scope." /></CardContent></Card>

  const latestRevision = source.data.revisions[source.data.revisions.length - 1]
  const comparisonRevision = source.data.revisions.find((revision) => revision.id === (compareRevisionId ?? source.data.revisions[source.data.revisions.length - 2]?.id))
  const Icon = source.data.source.kind === KnowledgeSourceKind.UploadedDocument ? FileText : Waypoints
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={source.data.source.name} description={`${source.data.source.provider ?? source.data.source.contentType ?? source.data.source.kind} · ${source.data.source.status.replace('_', ' ')}`} actions={<Button variant="outline" asChild><Link to="/sources"><ArrowLeft data-icon="inline-start" />All sources</Link></Button>} />
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4"><FreshnessCard label="Freshness" value={source.data.source.freshness ? humanizeKey(source.data.source.freshness.status) : 'Unavailable'} detail={source.data.source.freshness?.expiresAt ? `Expires ${formatDate(source.data.source.freshness.expiresAt)}` : 'Provider timestamp is not available'} /><FreshnessCard label="Latest revision" value={latestRevision ? latestRevision.revision : 'No revision'} detail={latestRevision ? formatDate(latestRevision.createdAt) : 'Awaiting acquisition'} /><FreshnessCard label="Observed" value={latestRevision?.observedAt ? formatDate(latestRevision.observedAt) : 'Not reported'} detail="Provider observation time" /><FreshnessCard label="Ingested" value={latestRevision?.ingestedAt ? formatDate(latestRevision.ingestedAt) : 'Not ingested'} detail="Normalized into context" /></div>
      <Card className="min-w-0">
        <CardHeader><CardTitle>Scope and provenance</CardTitle><CardDescription>Encois keeps access scope separate from provider configuration and immutable revision content.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4"><ScopeValue label="Provider" value={source.data.source.provider ?? 'Uploaded document'} /><ScopeValue label="Integration" value={source.data.source.integrationId ? <Link className="underline underline-offset-2" to="/integrations/$integrationId" params={{ integrationId: source.data.source.integrationId }}>Open Integration</Link> : 'Not applicable'} /><ScopeValue label="Read scope" value={source.data.source.readScope.ids.join(', ')} /><ScopeValue label="Visibility scope" value={source.data.source.visibilityScope.ids.join(', ')} /></CardContent>
      </Card>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader><div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-md border bg-muted/30"><Icon className="size-5 text-muted-foreground" aria-hidden="true" /></span><div><CardTitle><ProductTerm term="revision" plural /></CardTitle><CardDescription>Immutable snapshots retained with provenance metadata.</CardDescription></div></div></CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-3">
            {source.data.revisions.length ? source.data.revisions.map((revision) => <RevisionRow key={revision.id} revision={revision} onIngest={() => ingest.mutate(revision.id)} busy={ingest.isPending} />) : <EmptyPanel icon={FileText} title={<>No <ProductTerm term="revision" plural /></>} description={<>This source has not produced a <ProductTerm term="revision" /> yet.</>} />}
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            {source.data.revisions.length > 1 ? <div className="mt-2 rounded-lg border bg-muted/20 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium" htmlFor="compare-source-revision">Compare latest with<select id="compare-source-revision" value={comparisonRevision?.id ?? ''} onChange={(event) => setCompareRevisionId(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><option value="">Select a revision</option>{source.data.revisions.filter((revision) => revision.id !== latestRevision?.id).map((revision) => <option key={revision.id} value={revision.id}>{revision.revision} · {revision.status}</option>)}</select></label><span className="text-xs text-muted-foreground">History is immutable; compare shows stored provenance metadata.</span></div>{comparisonRevision && latestRevision ? <RevisionComparison current={latestRevision} previous={comparisonRevision} /> : null}</div> : null}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader><CardTitle><ProductTerm term="ingestion" /> activity</CardTitle><CardDescription>Processing activity for this source.</CardDescription></CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-3">
            {source.data.ingestionRuns.length ? source.data.ingestionRuns.map((run) => <div key={run.id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{run.status}</span><span className="text-xs text-muted-foreground">{run.trigger}</span></div><p className="mt-2 text-xs text-muted-foreground">{run.currentStage ?? 'Queued for acquisition'} · {run.factsCount} facts</p>{run.error ? <p className="mt-2 text-xs text-destructive">{run.error}</p> : null}</div>) : <EmptyPanel icon={RefreshCw} title="No ingestion runs" description={latestRevision ? 'Start ingestion for the latest revision.' : 'Upload a revision first.'} />}
          </CardContent>
        </Card>
        {canManageKnowledge ? <Card className="min-w-0 lg:col-span-2">
          <CardHeader><CardTitle>Register a new revision</CardTitle><CardDescription>Add a provider-backed immutable snapshot. Existing revisions are never overwritten.</CardDescription></CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={handleRegisterRevision}>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="source-revision">Revision identifier<input id="source-revision" value={revision} onChange={(event) => setRevision(event.target.value)} placeholder="provider revision or commit" maxLength={128} required className="h-10 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50" /></label>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="source-artifact-ref">Artifact reference<span className="text-xs font-normal text-muted-foreground">Use an approved artifact:// or gs:// reference.</span><input id="source-artifact-ref" value={artifactRef} onChange={(event) => setArtifactRef(event.target.value)} placeholder="gs://bucket/object" className="h-10 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50" /></label>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="source-object-id">Provider object ID<input id="source-object-id" value={sourceObjectId} onChange={(event) => setSourceObjectId(event.target.value)} placeholder="Optional provider record ID" className="h-10 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50" /></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="source-content-type">Content type<input id="source-content-type" value={contentType} onChange={(event) => setContentType(event.target.value)} placeholder="application/json" className="h-10 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50" /></label>
                <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="source-checksum">Checksum <span className="text-xs font-normal text-muted-foreground">Optional integrity marker.</span><input id="source-checksum" value={checksum} onChange={(event) => setChecksum(event.target.value)} placeholder="sha256:…" className="h-10 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50" /></label>
                <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="source-observed-at">Observed at<input id="source-observed-at" type="datetime-local" value={observedAt} onChange={(event) => setObservedAt(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50" /></label>
              </div>
              {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
              <Button type="submit" disabled={registerRevision.isPending}>{registerRevision.isPending ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Plus data-icon="inline-start" />}{registerRevision.isPending ? 'Registering…' : 'Register revision'}</Button>
            </form>
          </CardContent>
        </Card> : null}
      </div>
    </div>
  )
}

function RevisionComparison({ current, previous }: { current: SourceRevision; previous: SourceRevision }) {
  const fields = [
    ['Revision', previous.revision, current.revision],
    ['Content type', previous.contentType ?? 'Not reported', current.contentType ?? 'Not reported'],
    ['Checksum', previous.checksum ?? 'Not reported', current.checksum ?? 'Not reported'],
    ['Artifact', previous.artifactRef ?? previous.sourceObjectId ?? 'Not reported', current.artifactRef ?? current.sourceObjectId ?? 'Not reported'],
    ['Observed', previous.observedAt ? formatDate(previous.observedAt) : 'Not reported', current.observedAt ? formatDate(current.observedAt) : 'Not reported'],
    ['Ingested', previous.ingestedAt ? formatDate(previous.ingestedAt) : 'Not ingested', current.ingestedAt ? formatDate(current.ingestedAt) : 'Not ingested'],
  ] as const
  return <div className="mt-4 overflow-x-auto rounded-md border bg-background"><table className="w-full min-w-[520px] text-left text-xs"><thead><tr className="border-b text-muted-foreground"><th className="px-3 py-2 font-medium">Field</th><th className="px-3 py-2 font-medium">{previous.revision}</th><th className="px-3 py-2 font-medium">{current.revision}</th></tr></thead><tbody>{fields.map(([label, before, after]) => <tr key={label} className="border-b last:border-0"><th className="px-3 py-2 font-medium text-muted-foreground">{label}</th><td className="max-w-56 break-all px-3 py-2">{before}</td><td className={`max-w-56 break-all px-3 py-2 ${before !== after ? 'font-medium text-foreground' : ''}`}>{after}</td></tr>)}</tbody></table></div>
}

function RevisionRow({ revision, onIngest, busy }: { revision: SourceRevision; onIngest: () => void; busy: boolean }) {
  const fileName = typeof revision.metadata?.fileName === 'string' ? revision.metadata.fileName : undefined
  return <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><FileText className="size-4 text-muted-foreground" aria-hidden="true" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{fileName ?? revision.revision}</p><p className="mt-1 truncate text-xs text-muted-foreground">{revision.contentType ?? 'Unknown type'} · observed {revision.observedAt ? formatDate(revision.observedAt) : 'unknown'} · ingested {revision.ingestedAt ? formatDate(revision.ingestedAt) : 'pending'}</p></div><span className="shrink-0 text-xs text-muted-foreground">{revision.status}</span><Button className="shrink-0" size="sm" variant="outline" onClick={onIngest} disabled={busy || revision.status === SourceRevisionStatus.Ingesting}>{busy ? <LoaderCircle className="animate-spin" /> : <Play />}<span className="hidden sm:inline">Ingest</span></Button></div>
}

function FreshnessCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <Card className="min-w-0"><CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0"><CardTitle className="min-w-0 text-sm font-medium text-muted-foreground">{label}</CardTitle><RefreshCw className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></CardHeader><CardContent className="min-w-0"><p className="truncate text-sm font-medium">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>
}

function ScopeValue({ label, value }: { label: string; value: ReactNode }) {
  return <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words font-medium">{value}</p></div>
}
