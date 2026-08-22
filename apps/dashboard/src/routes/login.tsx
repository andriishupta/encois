import { useState } from 'react'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { Activity, ArrowRight, Chrome } from 'lucide-react'
import { getAuthStatus, isApiError } from '@/lib/api'
import { getAuthSession, getDevelopmentAuthSession, hasPermission, isDashboardMockMode, isFirebaseAuthEmulatorConfigured, isIdentityPlatformConfigured, setAuthSession, signInWithEmail, signInWithGoogle, signOutFromIdentityPlatform } from '@/lib/auth'
import { getMockOnboardingState } from '@/lib/onboarding'
import { Permission } from '@encois/contracts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function postAuthPath(): '/' | '/onboarding/workspace' {
  const session = getAuthSession()
  return isDashboardMockMode() && hasPermission(session, Permission.OnboardingManage) && !getMockOnboardingState()?.onboardingComplete
    ? '/onboarding/workspace'
    : '/'
}

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    if (getAuthSession()) {
      throw redirect({ to: postAuthPath() })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [localEmail, setLocalEmail] = useState('dev@local.test')
  const [localPassword, setLocalPassword] = useState('local-password-1234')
  const developmentSession = getDevelopmentAuthSession()
  const googleConfigured = isIdentityPlatformConfigured()
  const emulatorConfigured = isFirebaseAuthEmulatorConfigured()

  async function continueWithGoogle() {
    setError(null)
    setIsSubmitting(true)
    try {
      await signInWithGoogle()
      const status = await getAuthStatus()
      if (status.status === 'pending') {
        await signOutFromIdentityPlatform()
        await navigate({ to: '/waitlist' })
        return
      }
      await navigate({ to: postAuthPath() })
    } catch (cause) {
      if (isApiError(cause) && cause.code === 'PERSISTENCE_UNAVAILABLE') {
        setError('Access provisioning is not available yet. Please try again later.')
      } else if (isApiError(cause) && cause.status === 401) {
        setError('This Google account is not enabled for Encois yet.')
      } else if (cause instanceof Error && cause.message.includes('popup')) {
        setError('Google sign-in was cancelled.')
      } else {
        setError('We could not complete Google sign-in. Please try again.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function continueWithLocalEmail() {
    setError(null)
    setIsSubmitting(true)
    try {
      await signInWithEmail(localEmail, localPassword)
      const status = await getAuthStatus()
      if (status.status === 'pending') {
        await signOutFromIdentityPlatform()
        await navigate({ to: '/waitlist' })
        return
      }
      await navigate({ to: postAuthPath() })
    } catch (cause) {
      if (isApiError(cause) && cause.status === 401) {
        setError('This local account is not enabled for Encois yet.')
      } else {
        setError('We could not complete local sign-in. Check the emulator credentials.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  function useLocalDevelopmentSession() {
    if (!developmentSession) return
    setAuthSession(developmentSession)
    void navigate({ to: postAuthPath() })
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
            <CardTitle className="text-2xl">Welcome back</CardTitle>
            <CardDescription>Encois is currently available by invitation only.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button type="button" className="w-full" disabled={!googleConfigured || isSubmitting} onClick={() => void continueWithGoogle()}>
            <Chrome data-icon="inline-start" />
            {isSubmitting ? 'Connecting to Google…' : 'Continue with Google'}
          </Button>

          {emulatorConfigured ? (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <p className="text-sm font-medium">Local Auth Emulator</p>
              <input aria-label="Local email" type="email" value={localEmail} onChange={(event) => setLocalEmail(event.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm" />
              <input aria-label="Local password" type="password" value={localPassword} onChange={(event) => setLocalPassword(event.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm" />
              <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => void continueWithLocalEmail()}>
                Sign in locally
              </Button>
            </div>
          ) : null}

          {developmentSession ? (
            <Button type="button" variant="outline" className="w-full" onClick={useLocalDevelopmentSession}>
              Use local development session
            </Button>
          ) : null}

          {!googleConfigured && !developmentSession ? (
            <p className="text-center text-xs text-muted-foreground">Google sign-in is not configured for this build.</p>
          ) : null}
          {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}

          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have access yet?{' '}
            <Link to="/waitlist" className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4">
              Join the waitlist
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
