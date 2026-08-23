import { lazy, Suspense, useState } from 'react'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { Activity, ArrowRight, Chrome } from 'lucide-react'
import { getAuthStatus, isApiError } from '@/lib/api'
import { getAuthSession, getDevelopmentAuthSession, isFirebaseAuthEmulatorConfigured, isIdentityPlatformConfigured, setAuthSession, signInWithGoogle, signOutFromIdentityPlatform } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const LocalAuthPanel = import.meta.env.DEV ? lazy(() => import('@/components/local-auth-panel')) : null

function postAuthPath(): '/' {
  return '/'
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
  const developmentSession = getDevelopmentAuthSession()
  const googleConfigured = isIdentityPlatformConfigured()
  const localAuthEnabled = import.meta.env.DEV && isFirebaseAuthEmulatorConfigured()

  async function completeSignIn() {
    const status = await getAuthStatus()
    if (status.status === 'pending') {
      await signOutFromIdentityPlatform()
      await navigate({ to: '/waitlist' })
      return
    }
    await navigate({ to: postAuthPath() })
  }

  async function continueWithGoogle() {
    setError(null)
    setIsSubmitting(true)
    try {
      await signInWithGoogle()
      await completeSignIn()
    } catch (cause) {
      if (isApiError(cause) && cause.code === 'PERSISTENCE_UNAVAILABLE') {
        setError('Access provisioning is not available yet.')
      } else if (isApiError(cause) && cause.status === 401) {
        setError('This Google account is not enabled for Encois yet.')
      } else if (cause instanceof Error && cause.message.includes('popup')) {
        setError('Google sign-in was cancelled.')
      } else {
        setError('Google sign-in could not be completed.')
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

          {localAuthEnabled && LocalAuthPanel ? (
            <Suspense fallback={<p className="text-center text-xs text-muted-foreground">Loading local authentication…</p>}>
              <LocalAuthPanel onAuthenticated={completeSignIn} />
            </Suspense>
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
