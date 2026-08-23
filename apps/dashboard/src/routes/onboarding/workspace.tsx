import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Building2, LoaderCircle, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getOrganization } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export const Route = createFileRoute('/onboarding/workspace')({
  component: WorkspaceSetupPage,
})

function WorkspaceSetupPage() {
  const navigate = useNavigate()
  const organization = useQuery({
    queryKey: queryKeys.organization(),
    queryFn: getOrganization,
  })

  if (organization.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Loading workspace…</div>
  }

  if (organization.isError || !organization.data) {
    return <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{organization.error?.message ?? 'The workspace could not be loaded.'}</p>
  }

  const { organization: workspace, units, members } = organization.data

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Set up your workspace</CardTitle>
          <CardDescription>Confirm the organization scope before adding the first source of organization context.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-center gap-3 rounded-lg border p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Building2 className="size-5" aria-hidden="true" /></span>
            <div className="min-w-0"><p className="truncate font-medium">{workspace.name}</p><p className="text-sm text-muted-foreground">{workspace.slug}</p></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Summary label="Organization units" value={units.length} />
            <Summary label="Workspace members" value={members.length} />
          </div>
          <div className="flex justify-end pt-2">
            <Button type="button" onClick={() => void navigate({ to: '/onboarding/memory' })}>Continue <ArrowRight data-icon="inline-end" /></Button>
          </div>
        </CardContent>
      </Card>

      <Card className="h-fit bg-primary text-primary-foreground">
        <CardHeader>
          <Building2 className="mb-2 size-5 text-primary-foreground/70" aria-hidden="true" />
          <CardTitle>Organization-scoped setup</CardTitle>
          <CardDescription className="text-primary-foreground/70">This information comes from the workspace control plane for the signed-in organization.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-primary-foreground/80">
          <p>The next step uploads a real organization context document as a scoped Knowledge Source.</p>
          <div className="flex items-start gap-3 rounded-lg border border-primary-foreground/15 bg-primary-foreground/10 p-3">
            <Users className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Workspace access and visibility remain controlled by the existing organization permissions.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>
}
