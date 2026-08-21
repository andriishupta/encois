import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, FileText, Plus, RefreshCw, Waypoints } from 'lucide-react'
import { KnowledgeSourceKind, KnowledgeSourceStatus, type KnowledgeSource } from '@encois/contracts'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { listKnowledgeSources } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export const Route = createFileRoute('/_app/sources/')({
  component: SourcesPage,
})

function SourcesPage() {
  const sources = useQuery({ queryKey: queryKeys.sources(), queryFn: listKnowledgeSources })

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Knowledge sources"
        description="The scoped inputs Encois can ingest into project context. Integrations are one source type; documents and manual inputs use the same pipeline."
        actions={<Button asChild><Link to="/sources/new"><Plus data-icon="inline-start" />Add source</Link></Button>}
      />
      {sources.isLoading ? <p className="text-sm text-muted-foreground">Loading sources…</p> : null}
      {sources.isError ? <Card><CardContent className="pt-6 text-sm text-destructive">Could not load Knowledge Sources: {sources.error.message}</CardContent></Card> : null}
      {sources.data?.length ? <div className="grid gap-4 md:grid-cols-2">{sources.data.map((source) => <SourceCard key={source.id} source={source} />)}</div> : null}
      {!sources.isLoading && !sources.isError && !sources.data?.length ? <Card>
        <CardContent className="pt-6">
          <EmptyPanel icon={Waypoints} title="No Knowledge Sources yet" description="Upload a project PDF or connect a provider. Encois needs at least one scoped source before the Coordinator can build useful context." action={<Button asChild><Link to="/sources/new"><Plus data-icon="inline-start" />Add your first source</Link></Button>} />
        </CardContent>
      </Card> : null}
    </div>
  )
}

function SourceCard({ source }: { source: KnowledgeSource }) {
  const Icon = source.kind === KnowledgeSourceKind.UploadedDocument ? FileText : Waypoints
  const statusLabel = source.status === KnowledgeSourceStatus.Ingesting ? 'Ingesting' : source.status.replace('_', ' ')
  return (
    <Link to="/sources/$sourceId" params={{ sourceId: source.id }} className="group">
      <Card className="h-full transition-colors group-hover:border-foreground/30">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/30"><Icon className="size-4 text-muted-foreground" aria-hidden="true" /></span>
            <div className="min-w-0"><CardTitle className="truncate">{source.name}</CardTitle><CardDescription className="mt-1">{source.provider ?? source.contentType ?? source.kind}</CardDescription></div>
          </div>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-1 text-secondary-foreground"><RefreshCw className="size-3" aria-hidden="true" />{statusLabel}</span>
          <span className="ml-auto truncate font-mono">{source.currentRevisionId ? 'revision ready' : 'no revision'}</span>
        </CardContent>
      </Card>
    </Link>
  )
}
