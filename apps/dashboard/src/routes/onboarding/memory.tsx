import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Check, FileText, Github, MessageSquare, PlugZap, Upload, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getMockOnboardingState, updateMockOnboardingState, type MemorySource } from '@/lib/onboarding'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/onboarding/memory')({
  beforeLoad: () => {
    const state = getMockOnboardingState()
    if (!state?.workspaceName) throw redirect({ to: '/onboarding/workspace' })
  },
  component: MemorySetupPage,
})

const sources: { id: MemorySource; label: string; description: string; icon: typeof Github }[] = [
  { id: 'slack', label: 'Slack', description: 'Team updates and decisions', icon: MessageSquare },
  { id: 'github', label: 'GitHub', description: 'Repositories and delivery activity', icon: Github },
  { id: 'jira', label: 'Jira', description: 'Projects, issues, and releases', icon: Workflow },
  { id: 'linear', label: 'Linear', description: 'Issues and project cycles', icon: PlugZap },
]

function MemorySetupPage() {
  const navigate = useNavigate()
  const existing = getMockOnboardingState()
  const [selectedSource, setSelectedSource] = useState<MemorySource | undefined>(existing?.memorySource)
  const [sourceLabel, setSourceLabel] = useState(existing?.memorySourceLabel)

  function selectSource(source: MemorySource, label: string) {
    setSelectedSource(source)
    setSourceLabel(label)
  }

  function handleDocument(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) selectSource('document', file.name)
  }

  function handleContinue() {
    if (!selectedSource || !sourceLabel) return
    updateMockOnboardingState({ memorySource: selectedSource, memorySourceLabel: sourceLabel })
    void navigate({ to: '/onboarding/coordination' })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Give your Coordinator some memory</h1>
        <p className="mt-2 text-muted-foreground">Connect at least one source of project context. This is required before Encois can produce useful, evidence-backed insights.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Choose a first source</CardTitle>
          <CardDescription>You can connect more sources after setup. Nothing is fetched in this UI preview.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {sources.map((source) => {
            const Icon = source.icon
            const selected = selectedSource === source.id
            return (
              <button key={source.id} type="button" aria-pressed={selected} onClick={() => selectSource(source.id, source.label)} className={cn('flex items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent', selected && 'border-primary bg-accent')}>
                <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground', selected && 'bg-primary text-primary-foreground')}><Icon className="size-4" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{source.label}</span><span className="mt-1 block text-xs text-muted-foreground">{source.description}</span></span>
                {selected ? <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" /> : null}
              </button>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Or add a project document</CardTitle>
          <CardDescription>A brief, architecture note, roadmap, or another file is enough to start.</CardDescription>
        </CardHeader>
        <CardContent>
          <label className={cn('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors hover:bg-accent', selectedSource === 'document' && 'border-primary bg-accent')}>
            <span className="flex size-10 items-center justify-center rounded-full bg-muted"><FileText className="size-5 text-muted-foreground" aria-hidden="true" /></span>
            <span className="text-sm font-medium">{selectedSource === 'document' ? sourceLabel : 'Upload a project document'}</span>
            <span className="text-xs text-muted-foreground">PDF, Markdown, or text · mocked locally for now</span>
            <span className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium"><Upload className="size-3.5" aria-hidden="true" /> Choose file</span>
            <input type="file" accept=".pdf,.md,.markdown,.txt" className="sr-only" onChange={handleDocument} />
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-muted-foreground">{selectedSource ? `Selected: ${sourceLabel}` : 'Select at least one source to continue.'}</p>
        <Button type="button" disabled={!selectedSource} onClick={handleContinue}>
          Continue
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}
