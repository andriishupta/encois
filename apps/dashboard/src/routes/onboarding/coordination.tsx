import { useState, type ReactNode } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Bot, Check, Radio, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ProductTerm } from '@/components/product-term'
import { getMockOnboardingState, updateMockOnboardingState, type CoordinationMode } from '@/lib/onboarding'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/onboarding/coordination')({
  beforeLoad: () => {
    const state = getMockOnboardingState()
    if (!state?.workspaceName) throw redirect({ to: '/onboarding/workspace' })
    if (!state.memorySource) throw redirect({ to: '/onboarding/memory' })
  },
  component: CoordinationSetupPage,
})

function CoordinationSetupPage() {
  const navigate = useNavigate()
  const existing = getMockOnboardingState()
  const [mode, setMode] = useState<CoordinationMode>(existing?.coordinationMode ?? 'start-coordinator')

  function handleContinue() {
    updateMockOnboardingState({ coordinationMode: mode })
    void navigate({ to: '/onboarding/workflows' })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Choose how to initialize your workspace</h1>
          <p className="mt-2 text-muted-foreground">Your first <ProductTerm term="coordinator" /> run will inspect the context you selected and prepare a safe starting point for your workspace.</p>
        </div>
        <div className="flex flex-col gap-3">
          <ModeCard selected={mode === 'start-coordinator'} onClick={() => setMode('start-coordinator')} icon={Sparkles} title={<>Start the first <ProductTerm term="coordinator" /> run</>} description="Recommended. Prepare context and propose workflows from the sources you connected." />
          <ModeCard selected={mode === 'connect-only'} onClick={() => setMode('connect-only')} icon={Radio} title="Connect sources only" description="Leave initialization pending and review the workspace before the first Coordinator run." />
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={handleContinue}>
            Review workflows
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="size-4 text-muted-foreground" aria-hidden="true" /> <ProductTerm term="coordinator" /> bootstrap</CardTitle>
          <CardDescription>The first run stays read-only and creates a reviewable plan.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {['Read the selected project context', 'Check available integration capabilities', 'Propose standard workflows for review'].map((item) => (
            <div key={item} className="flex items-center gap-3 rounded-md border px-3 py-3 text-sm">
              <span className="flex size-6 items-center justify-center rounded-full bg-muted"><Check className="size-3.5 text-muted-foreground" aria-hidden="true" /></span>
              {item}
            </div>
          ))}
          <p className="pt-2 text-xs text-muted-foreground">External systems are not changed by this setup.</p>
        </CardContent>
      </Card>
    </div>
  )
}

function ModeCard({ selected, onClick, icon: Icon, title, description }: { selected: boolean; onClick: () => void; icon: typeof Sparkles; title: ReactNode; description: ReactNode }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={cn('flex items-start gap-4 rounded-lg border bg-background p-4 text-left transition-colors hover:bg-accent', selected && 'border-primary bg-accent')}>
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground', selected && 'bg-primary text-primary-foreground')}><Icon className="size-5" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-sm text-muted-foreground">{description}</span></span>
      <span className={cn('mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border', selected && 'border-primary bg-primary text-primary-foreground')}>{selected ? <Check className="size-3" aria-hidden="true" /> : null}</span>
    </button>
  )
}
