import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Save } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/_app/workflows/new')({
  component: NewWorkflowPage,
})

function NewWorkflowPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="New workflow" description="Create the definition for a future investigation workflow." />
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Workflow details</CardTitle>
          <CardDescription>This form is UI-only for now. Saving will be connected to the Gateway API later.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="workflow-name">
              Name
              <input id="workflow-name" type="text" placeholder="Release risk investigation" className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="workflow-key">
              Workflow key
              <input id="workflow-key" type="text" placeholder="release-risk" className="h-9 rounded-md border border-input bg-background px-3 font-mono text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" />
            </label>
          </div>
          <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="workflow-description">
            Description
            <textarea id="workflow-description" rows={4} placeholder="What should this investigation explain?" className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" />
          </label>
          <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-between">
            <Button variant="ghost" asChild>
              <Link to="/workflows">
                <ArrowLeft data-icon="inline-start" />
                Cancel
              </Link>
            </Button>
            <Button type="button" disabled>
              <Save data-icon="inline-start" />
              Save workflow
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
