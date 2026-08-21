import { useState, type FormEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Activity, ArrowLeft, Check } from 'lucide-react'
import { validateWaitlistRequest } from '@encois/contracts'
import { ApiError, submitWaitlist } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/waitlist')({
  component: WaitlistPage,
})

type WaitlistForm = {
  email: string
  displayName: string
  companyName: string
  companyWebsite: string
  companyLinkedinUrl: string
  message: string
}

const initialForm: WaitlistForm = {
  email: '',
  displayName: '',
  companyName: '',
  companyWebsite: '',
  companyLinkedinUrl: '',
  message: '',
}

function WaitlistPage() {
  const [form, setForm] = useState<WaitlistForm>(initialForm)
  const [submitted, setSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const environment = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}
  const supportEmail = environment.VITE_ENCOIS_SUPPORT_EMAIL?.trim()
  const creatorEmail = environment.VITE_ENCOIS_CREATOR_EMAIL?.trim()

  function updateField(field: keyof WaitlistForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const validation = validateWaitlistRequest(form)
      if (!validation.ok) {
        setError(validation.issue.message)
        return
      }
      await submitWaitlist(validation.value)
      setSubmitted(true)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'We could not save your request. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-8">
      <Card className="w-full max-w-lg">
        <CardHeader className="gap-4">
          <Link to="/login" className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="size-4" aria-hidden="true" />
            Encois
          </Link>
          <div className="flex flex-col gap-1.5">
            <CardTitle className="text-2xl">Join the waitlist</CardTitle>
            <CardDescription>Encois is available by invitation while we prepare the first organizations.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-5">
              <div className="flex items-center gap-2 font-medium">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-4" aria-hidden="true" />
                </span>
                Request received
              </div>
              <p className="text-sm text-muted-foreground">We&apos;ll contact you when access is available.</p>
              <Button variant="outline" asChild>
                <Link to="/login">Back to sign in</Link>
              </Button>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="waitlist-email">
                Work email
                <input id="waitlist-email" name="email" type="email" inputMode="email" required value={form.email} onChange={(event) => updateField('email', event.target.value)} className={inputClassName} placeholder="you@company.com" />
                <span className="text-xs font-normal text-muted-foreground">Use your company email, not Gmail or another personal mailbox.</span>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="waitlist-name">
                Name <span className="font-normal text-muted-foreground">(optional)</span>
                <input id="waitlist-name" name="displayName" value={form.displayName} onChange={(event) => updateField('displayName', event.target.value)} className={inputClassName} placeholder="Alex Morgan" />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="waitlist-company">
                Company
                <input id="waitlist-company" name="companyName" required value={form.companyName} onChange={(event) => updateField('companyName', event.target.value)} className={inputClassName} placeholder="Acme Inc." />
              </label>
              <fieldset className="flex flex-col gap-3">
                <legend className="text-sm font-medium">Company website or LinkedIn</legend>
                <p className="text-xs text-muted-foreground">Provide at least one so we can verify the company.</p>
                <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="waitlist-company-website">
                  Website <span className="font-normal text-muted-foreground">(optional if LinkedIn is provided)</span>
                  <input id="waitlist-company-website" name="companyWebsite" type="url" value={form.companyWebsite} onChange={(event) => updateField('companyWebsite', event.target.value)} className={inputClassName} placeholder="https://company.com" />
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="waitlist-company-linkedin">
                  Company LinkedIn <span className="font-normal text-muted-foreground">(optional if website is provided)</span>
                  <input id="waitlist-company-linkedin" name="companyLinkedinUrl" type="url" value={form.companyLinkedinUrl} onChange={(event) => updateField('companyLinkedinUrl', event.target.value)} className={inputClassName} placeholder="https://www.linkedin.com/company/acme" />
                </label>
              </fieldset>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="waitlist-message">
                What are you working on? <span className="font-normal text-muted-foreground">(optional)</span>
                <textarea id="waitlist-message" name="message" value={form.message} onChange={(event) => updateField('message', event.target.value)} className={`${inputClassName} min-h-24 resize-y py-2`} placeholder="Tell us what context you want Encois to connect." />
              </label>
              {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={isSubmitting} className="mt-2 w-full">
                {isSubmitting ? 'Sending request…' : 'Request access'}
              </Button>
            </form>
          )}

          {supportEmail || creatorEmail ? (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {supportEmail ? <a className="underline underline-offset-4" href={`mailto:${supportEmail}`}>Contact support</a> : null}
              {creatorEmail ? <a className="underline underline-offset-4" href={`mailto:${creatorEmail}`}>Contact creator</a> : null}
            </div>
          ) : null}
          <Link to="/login" className="mt-6 flex items-center justify-center gap-1 text-sm text-muted-foreground underline underline-offset-4">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}

const inputClassName = 'h-10 rounded-md border border-input bg-background px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50'
