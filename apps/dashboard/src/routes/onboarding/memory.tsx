import { useState, type ChangeEvent } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Check, FileText, Github, LoaderCircle, MessageSquare, PlugZap, Upload, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ApiError, startSourceIngestion, uploadKnowledgeSourcePdf } from '@/lib/api'
import { getMockOnboardingState, updateMockOnboardingState, type MemorySource } from '@/lib/onboarding'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/onboarding/memory')({
  beforeLoad: () => {
    const state = getMockOnboardingState()
    if (!state?.workspaceName) throw redirect({ to: '/onboarding/workspace' })
  },
  component: MemorySetupPage,
})

const integrationSources: { id: MemorySource; label: string; description: string; icon: typeof Github }[] = [
  { id: 'slack', label: 'Slack', description: 'Team updates and decisions', icon: MessageSquare },
  { id: 'github', label: 'GitHub', description: 'Repositories and delivery activity', icon: Github },
  { id: 'jira', label: 'Jira', description: 'Projects, issues, and releases', icon: Workflow },
  { id: 'linear', label: 'Linear', description: 'Issues and project cycles', icon: PlugZap },
]

function MemorySetupPage() {
  const navigate = useNavigate()
  const existing = getMockOnboardingState()
  const [selectedSource, setSelectedSource] = useState<MemorySource | undefined>(existing?.memorySource === 'document' && existing.memorySourceId ? 'document' : undefined)
  const [sourceLabel, setSourceLabel] = useState(existing?.memorySource === 'document' && existing.memorySourceId ? existing.memorySourceLabel : undefined)
  const [file, setFile] = useState<File | undefined>()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleDocument(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0]
    if (!nextFile) return
    setFile(nextFile)
    setSelectedSource('document')
    setSourceLabel(nextFile.name)
    setError(null)
  }

  async function handleContinue() {
    if (!file && !existing?.memorySourceId) {
      setError('Upload at least one PDF to continue. This step cannot be skipped.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      let sourceId = existing?.memorySourceId
      if (file) {
        const uploaded = await uploadKnowledgeSourcePdf(file, sourceLabel)
        sourceId = uploaded.source.id
        await startSourceIngestion(uploaded.source.id, uploaded.revision.id)
        updateMockOnboardingState({ memorySource: 'document', memorySourceLabel: sourceLabel ?? file.name, memorySourceId: sourceId })
      }
      if (!sourceId) throw new Error('The source was not created.')
      void navigate({ to: '/onboarding/coordination' })
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The source could not be uploaded.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Give your Coordinator some memory</h1>
        <p className="mt-2 text-muted-foreground">Connect at least one source of project context. This is required before Encois can produce useful, evidence-backed insights.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload the first source</CardTitle>
          <CardDescription>PDF upload is available now. The file becomes a scoped source revision and starts the common ingestion workflow.</CardDescription>
        </CardHeader>
        <CardContent>
          <label className={cn('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors hover:bg-accent', selectedSource === 'document' && 'border-primary bg-accent')} htmlFor="onboarding-source-file">
            <span className="flex size-10 items-center justify-center rounded-full bg-muted"><FileText className="size-5 text-muted-foreground" aria-hidden="true" /></span>
            <span className="text-sm font-medium">{file?.name ?? sourceLabel ?? 'Choose a project PDF'}</span>
            <span className="text-xs text-muted-foreground">PDF only · maximum 10 MiB</span>
            <span className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium"><Upload className="size-3.5" aria-hidden="true" /> Choose file</span>
            <input id="onboarding-source-file" type="file" accept="application/pdf,.pdf" className="sr-only" onChange={handleDocument} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>More source types</CardTitle>
          <CardDescription>Provider connectors use the same Knowledge Source boundary and can be connected after the first source is uploaded.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {integrationSources.map((source) => {
            const Icon = source.icon
            return <div key={source.id} className="flex items-start gap-3 rounded-lg border p-4 opacity-60"><span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{source.label}</span><span className="mt-1 block text-xs text-muted-foreground">{source.description} · Connect after setup</span></span><Check className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></div>
          })}
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <div className="flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-muted-foreground">{selectedSource ? `Selected: ${sourceLabel}` : 'Select a PDF source to continue.'}</p>
        <Button type="button" disabled={uploading || (!file && !existing?.memorySourceId)} onClick={() => void handleContinue()}>{uploading ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}{uploading ? 'Uploading source…' : 'Continue'}<ArrowRight data-icon="inline-end" /></Button>
      </div>
    </div>
  )
}
