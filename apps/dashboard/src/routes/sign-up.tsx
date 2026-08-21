import { createFileRoute, Link } from '@tanstack/react-router'
import { Activity, ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/sign-up')({
  component: SignUpPage,
})

function SignUpPage() {
  return (
    <main className="grid min-h-svh lg:grid-cols-[0.9fr_1.1fr]">
      <section className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary-foreground text-primary">
            <Activity className="size-4" aria-hidden="true" />
          </span>
          Encois
        </Link>
        <div className="max-w-md">
          <p className="mb-5 text-sm text-primary-foreground/70">Context intelligence for your organization</p>
          <h1 className="text-4xl font-semibold tracking-tight">Start with the context your Coordinator needs.</h1>
          <div className="mt-8 flex flex-col gap-4 text-sm text-primary-foreground/80">
            {['Create your workspace', 'Connect one source of project memory', 'Review your first workflows'].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <span className="flex size-6 items-center justify-center rounded-full border border-primary-foreground/30">
                  <Check className="size-3.5" aria-hidden="true" />
                </span>
                {item}
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-primary-foreground/60">Encois setup takes a few minutes.</p>
      </section>

      <section className="flex items-center justify-center bg-muted/30 px-4 py-8 sm:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="gap-4">
            <Link to="/" className="flex items-center gap-2 text-sm font-semibold lg:hidden">
              <Activity className="size-4" aria-hidden="true" />
              Encois
            </Link>
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-2xl">Create your account</CardTitle>
              <CardDescription>We will use this account to set up your first workspace.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4">
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="name">
                Full name
                <input id="name" name="name" disabled placeholder="Alex Morgan" className={inputClassName} />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="email">
                Work email
                <input id="email" name="email" disabled type="email" placeholder="you@company.com" className={inputClassName} />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="password">
                Password
                <input id="password" name="password" disabled type="password" placeholder="••••••••" className={inputClassName} />
              </label>
              <Button type="button" disabled className="mt-2 w-full">
                Create account
                <ArrowRight data-icon="inline-end" />
              </Button>
              <p className="text-center text-xs text-muted-foreground">Account creation is not enabled until the Identity Platform client is configured.</p>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link to="/login" className="font-medium text-foreground underline underline-offset-4">Sign in</Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}

const inputClassName = 'h-10 rounded-md border border-input bg-background px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50'
