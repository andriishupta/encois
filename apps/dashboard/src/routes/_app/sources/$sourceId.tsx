import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileText, LoaderCircle, Play, RefreshCw, Waypoints } from 'lucide-react'
import { SourceRevisionStatus, KnowledgeSourceKind, type SourceRevision } from '@encois/contracts'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ApiError, getKnowledgeSource, startSourceIngestion } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export const Route = createFileRoute('/_app/sources/$sourceId')({
  component: SourceDetailPage,
})

function SourceDetailPage() {
  const { sourceId } = Route.useParams()
  const queryClient = useQueryClient()
  const source = useQuery({ queryKey: queryKeys.source(sourceId), queryFn: () => getKnowledgeSource(sourceId), refetchInterval: 30_000 })
  const [error, setError] = useState<string | null>(null)
  const ingest = useMutation({
    mutationFn: (revisionId: string) => startSourceIngestion(sourceId, revisionId),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.source(sourceId) }); setError(null) },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Ingestion could not be started.'),
  })

  if (source.isLoading) return <p className="text-sm text-muted-foreground">Loading source…</p>
  if (source.isError) return <Card><CardContent className="pt-6 text-sm text-destructive">Could not load source: {source.error.message}</CardContent></Card>
  if (!source.data) return <Card><CardContent className="pt-6"><EmptyPanel icon={Waypoints} title="Source not found" description="This source is not visible in the current organization scope." /></CardContent></Card>

  const latestRevision = source.data.revisions[source.data.revisions.length - 1]
  const Icon = source.data.source.kind === KnowledgeSourceKind.UploadedDocument ? FileText : Waypoints
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={source.data.source.name} description={`${source.data.source.provider ?? source.data.source.contentType ?? source.data.source.kind} · ${source.data.source.status.replace('_', ' ')}`} actions={<Button variant="outline" asChild><Link to="/sources"><ArrowLeft data-icon="inline-start" />All sources</Link></Button>} />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader><div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-md border bg-muted/30"><Icon className="size-5 text-muted-foreground" aria-hidden="true" /></span><div><CardTitle>Source revisions</CardTitle><CardDescription>Immutable snapshots retained with provenance metadata.</CardDescription></div></div></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {source.data.revisions.length ? source.data.revisions.map((revision) => <RevisionRow key={revision.id} revision={revision} onIngest={() => ingest.mutate(revision.id)} busy={ingest.isPending} />) : <EmptyPanel icon={FileText} title="No revisions" description="This source has not produced a revision yet." />}
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Ingestion activity</CardTitle><CardDescription>The API projection of the Temporal source-ingestion workflow.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {source.data.ingestionRuns.length ? source.data.ingestionRuns.map((run) => <div key={run.id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{run.status}</span><span className="text-xs text-muted-foreground">{run.trigger}</span></div><p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{run.temporalWorkflowId}</p><p className="mt-2 text-xs text-muted-foreground">{run.currentStage ?? 'Queued for acquisition'} · {run.factsCount} facts</p>{run.error ? <p className="mt-2 text-xs text-destructive">{run.error}</p> : null}</div>) : <EmptyPanel icon={RefreshCw} title="No ingestion runs" description={latestRevision ? 'Start ingestion for the latest revision.' : 'Upload a revision first.'} />}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function RevisionRow({ revision, onIngest, busy }: { revision: SourceRevision; onIngest: () => void; busy: boolean }) {
  const fileName = typeof revision.metadata?.fileName === 'string' ? revision.metadata.fileName : undefined
  return <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><FileText className="size-4 text-muted-foreground" aria-hidden="true" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{fileName ?? revision.revision}</p><p className="mt-1 truncate text-xs text-muted-foreground">{revision.contentType ?? 'Unknown type'} · {revision.checksum ? `${revision.checksum.slice(0, 16)}…` : 'No checksum'}</p></div><span className="text-xs text-muted-foreground">{revision.status}</span><Button size="sm" variant="outline" onClick={onIngest} disabled={busy || revision.status === SourceRevisionStatus.Ingesting}>{busy ? <LoaderCircle className="animate-spin" /> : <Play />}<span className="hidden sm:inline">Ingest</span></Button></div>
}
