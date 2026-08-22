import { useState } from 'react'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, FileText, LoaderCircle, Save, ShieldAlert, Upload } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { isApiError, startSourceIngestion, uploadKnowledgeSourcePdf } from '@/lib/api'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { Permission } from '@encois/contracts'

export const Route = createFileRoute('/_app/sources/new')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.KnowledgeManage)) throw redirect({ to: '/forbidden' })
  },
  component: NewSourcePage,
})

function NewSourcePage() {
  const navigate = useNavigate()
  const canManageKnowledgeSources = hasPermission(getAuthSession(), Permission.KnowledgeManage)
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | undefined>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canManageKnowledgeSources) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Add knowledge source" description={<><ProductTerm term="knowledgeSource" plural /> are managed by users with the appropriate organization permission.</>} />
        <Card className="max-w-3xl">
          <CardContent className="pt-6">
            <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
            <h2 className="mt-5 text-xl font-semibold">You cannot manage <ProductTerm term="knowledgeSource" plural /></h2>
            <p className="mt-2 text-sm text-muted-foreground">Please reach out to your company administrator to request permission. Your current organization scope remains read-only for this area.</p>
            <Button asChild className="mt-6"><Link to="/sources">Back to Knowledge Sources</Link></Button>
          </CardContent>
        </Card>
      </div>
    )
  }

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
      <PageHeader title="Add knowledge source" description={<>Upload a PDF as an immutable source <ProductTerm term="revision" />. Encois will process it and prepare the content for your workspace.</>} />
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
