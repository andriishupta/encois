import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Save } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { startReleaseInvestigation } from '@/lib/api'

export const Route = createFileRoute('/_app/workflows/new')({
  component: NewWorkflowPage,
})

function NewWorkflowPage() {
  const navigate = useNavigate()
  const [projectKey, setProjectKey] = useState('DEMO')
  const [releaseKey, setReleaseKey] = useState('mock-release-aug-30')
  const [targetDate, setTargetDate] = useState('')
  const mutation = useMutation({
    mutationFn: () => startReleaseInvestigation({ projectKey, releaseKey, targetDate: targetDate || undefined }),
    onSuccess: (response) => navigate({ to: '/workflows/$workflowId', params: { workflowId: response.workflow.workflowId } }),
  })

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="New workflow" description="Start a typed release investigation through the Gateway API." />
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Workflow details</CardTitle>
          <CardDescription>Creates a release-investigation.v1 Blueprint execution. The same release key reuses the active workflow.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="project-key">
              Project key
              <input id="project-key" value={projectKey} onChange={(event) => setProjectKey(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 font-mono text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="release-key">
              Release key
              <input id="release-key" value={releaseKey} onChange={(event) => setReleaseKey(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 font-mono text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" />
            </label>
          </div>
          <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="target-date">
            Target date <span className="font-normal text-muted-foreground">(optional)</span>
            <input id="target-date" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/50" />
          </label>
          {mutation.isError ? <p className="text-sm text-destructive">Could not start investigation: {mutation.error.message}</p> : null}
          <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-between">
            <Button variant="ghost" asChild>
              <Link to="/workflows">
                <ArrowLeft data-icon="inline-start" />
                Cancel
              </Link>
            </Button>
            <Button type="button" disabled={mutation.isPending || !projectKey.trim() || !releaseKey.trim()} onClick={() => mutation.mutate()}>
              <Save data-icon="inline-start" />
              {mutation.isPending ? 'Starting…' : 'Start investigation'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
