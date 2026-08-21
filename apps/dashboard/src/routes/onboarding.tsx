import { Outlet, createFileRoute, Link, redirect, useRouterState } from '@tanstack/react-router'
import { Activity, Check, Circle } from 'lucide-react'
import { getAuthSession, isDashboardMockMode } from '@/lib/auth'

export const Route = createFileRoute('/onboarding')({
  beforeLoad: () => {
    if (!getAuthSession()) throw redirect({ to: '/login' })
    if (!isDashboardMockMode()) throw redirect({ to: '/' })
  },
  component: OnboardingLayout,
})

const steps = [
  { label: 'Workspace', to: '/onboarding/workspace' },
  { label: 'Project memory', to: '/onboarding/memory' },
  { label: 'Coordinator', to: '/onboarding/coordination' },
  { label: 'Workflows', to: '/onboarding/workflows' },
] as const

function OnboardingLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const currentStep = Math.max(0, steps.findIndex((step) => pathname === step.to))

  return (
    <div className="min-h-svh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Activity className="size-4" aria-hidden="true" />
            </span>
            Encois
          </Link>
          <div className="text-right text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Workspace setup</p>
            <p>Step {currentStep + 1} of {steps.length}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <div className="mx-auto mb-10 max-w-3xl">
          <div className="flex items-start justify-between">
            {steps.map((step, index) => {
              const completed = index < currentStep
              const active = index === currentStep
              return (
                <div key={step.to} className="flex flex-1 items-start last:flex-none">
                  <div className="flex flex-col items-center gap-2">
                    <span className={`flex size-8 items-center justify-center rounded-full border text-xs font-medium ${completed ? 'border-primary bg-primary text-primary-foreground' : active ? 'border-primary text-primary' : 'border-border bg-background text-muted-foreground'}`}>
                      {completed ? <Check className="size-4" aria-hidden="true" /> : active ? <span className="size-2 rounded-full bg-primary" /> : <Circle className="size-3.5" aria-hidden="true" />}
                    </span>
                    <span className={`hidden text-xs sm:block ${active ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{step.label}</span>
                  </div>
                  {index < steps.length - 1 ? <div className={`mt-4 h-px flex-1 ${index < currentStep ? 'bg-primary' : 'bg-border'}`} /> : null}
                </div>
              )
            })}
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  )
}
