import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, FileText, LoaderCircle, Save, Upload } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { isApiError, startSourceIngestion, uploadKnowledgeSourcePdf } from '@/lib/api'

export const Route = createFileRoute('/_app/sources/new')({
  component: NewSourcePage,
})

function NewSourcePage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | undefined>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) {
      setError('Choose a PDF before saving the source.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const uploaded = await uploadKnowledgeSourcePdf(file, name)
      await startSourceIngestion(uploaded.source.id, uploaded.revision.id)
      await navigate({ to: '/sources/$sourceId', params: { sourceId: uploaded.source.id } })
    } catch (cause) {
      setError(isApiError(cause) ? cause.message : 'The source could not be uploaded.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Add knowledge source" description="Upload a PDF as an immutable source revision. The Gateway stores the raw file outside Postgres and starts the shared ingestion workflow." />
      <form className="max-w-3xl" onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <div className="flex size-10 items-center justify-center rounded-md border bg-muted/30"><FileText className="size-5 text-muted-foreground" aria-hidden="true" /></div>
            <CardTitle>Project document</CardTitle>
            <CardDescription>PDF only for now, up to 10 MiB. The upload is assigned the caller’s current authorized scope.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="source-name">Source name <input id="source-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Project architecture" className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" /></label>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors hover:bg-accent" htmlFor="source-file">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted"><Upload className="size-5 text-muted-foreground" aria-hidden="true" /></span>
              <span className="text-sm font-medium">{file?.name ?? 'Choose a PDF'}</span>
              <span className="text-xs text-muted-foreground">PDF · maximum 10 MiB</span>
              <input id="source-file" type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => setFile(event.target.files?.[0])} />
            </label>
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-between">
              <Button variant="ghost" asChild><Link to="/sources"><ArrowLeft data-icon="inline-start" />Cancel</Link></Button>
              <Button type="submit" disabled={saving || !file}>{saving ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}Upload and ingest</Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
