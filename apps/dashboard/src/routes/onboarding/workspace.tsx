import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Building2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getMockOnboardingState, updateMockOnboardingState } from '@/lib/onboarding'

export const Route = createFileRoute('/onboarding/workspace')({
  component: WorkspaceSetupPage,
})

function WorkspaceSetupPage() {
  const navigate = useNavigate()
  const existing = getMockOnboardingState()
  const [workspaceName, setWorkspaceName] = useState(existing?.workspaceName ?? '')
  const [teamSize, setTeamSize] = useState(existing?.teamSize ?? '11–50')
  const [projectCount, setProjectCount] = useState(existing?.projectCount ?? '1–5')
  const [companyWebsite, setCompanyWebsite] = useState(existing?.companyWebsite ?? '')

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    updateMockOnboardingState({ workspaceName, teamSize, projectCount, companyWebsite })
    void navigate({ to: '/onboarding/memory' })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Tell us about your workspace</CardTitle>
          <CardDescription>This gives the Coordinator a first scope for the context it will collect.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="workspace-name">
              Workspace name
              <input id="workspace-name" required value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Acme engineering" className={inputClassName} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="team-size">
                Team size
                <select id="team-size" value={teamSize} onChange={(event) => setTeamSize(event.target.value)} className={inputClassName}>
                  <option>1–10</option><option>11–50</option><option>51–200</option><option>201+</option>
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="project-count">
                Active projects
                <select id="project-count" value={projectCount} onChange={(event) => setProjectCount(event.target.value)} className={inputClassName}>
                  <option>1–5</option><option>6–20</option><option>21–50</option><option>50+</option>
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="company-website">
              Company website <span className="font-normal text-muted-foreground">Optional</span>
              <input id="company-website" type="url" value={companyWebsite} onChange={(event) => setCompanyWebsite(event.target.value)} placeholder="https://acme.com" className={inputClassName} />
            </label>
            <div className="flex justify-end pt-2">
              <Button type="submit">
                Continue
                <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="h-fit bg-primary text-primary-foreground">
        <CardHeader>
          <Building2 className="mb-2 size-5 text-primary-foreground/70" aria-hidden="true" />
          <CardTitle>Why this is required</CardTitle>
          <CardDescription className="text-primary-foreground/70">Every Encois workspace has its own scope, memory, and Coordinator.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-primary-foreground/80">
          <p>We use this information to keep insights tied to the right organization and projects.</p>
          <div className="flex items-start gap-3 rounded-lg border border-primary-foreground/15 bg-primary-foreground/10 p-3">
            <Users className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>The setup cannot be skipped because an unscoped Coordinator would not have trustworthy context.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

const inputClassName = 'h-10 rounded-md border border-input bg-background px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50'

