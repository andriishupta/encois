import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { Activity, ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAuthSession, getDevelopmentAuthSession, setAuthSession } from '@/lib/auth'
import { getMockOnboardingState } from '@/lib/onboarding'

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    if (getAuthSession()) {
      throw redirect({ to: getMockOnboardingState()?.onboardingComplete ? '/' : '/onboarding/workspace' })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const developmentSession = getDevelopmentAuthSession()

  function signInWithDevelopmentSession() {
    if (!developmentSession) return
    setAuthSession(developmentSession)
    void navigate({ to: getMockOnboardingState()?.onboardingComplete ? '/' : '/onboarding/workspace' })
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="gap-4">
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="size-4" aria-hidden="true" />
            Encois
          </Link>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            <CardDescription>Sign in to continue to your workspace.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="email">
            Email
            <input id="email" name="email" type="email" placeholder="you@company.com" className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="password">
            Password
            <input id="password" name="password" type="password" placeholder="••••••••" className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" />
          </label>
          <Button type="button" className="w-full" disabled={!developmentSession} onClick={signInWithDevelopmentSession}>
            {developmentSession ? 'Use local development session' : 'Sign in'}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {developmentSession
              ? 'Identity Platform token loaded from the local development environment.'
              : 'Identity Platform client sign-in is not configured for this build.'}
          </p>
          <p className="text-center text-sm text-muted-foreground">
            New to Encois?{' '}
            <Link to="/sign-up" className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4">
              Create an account
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </p>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/login">
              <ArrowLeft data-icon="inline-start" />
              Stay on sign in
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
