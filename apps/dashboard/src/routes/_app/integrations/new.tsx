import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { ArrowLeft, PlugZap, Save } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { Permission } from '@encois/contracts'

export const Route = createFileRoute('/_app/integrations/new')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.IntegrationsManage)) throw redirect({ to: '/forbidden' })
  },
  component: NewIntegrationPage,
})

function NewIntegrationPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Add integration" description={<>Register a read-only source for your organization context. <ProductTerm term="scope" /> is set below.</>} />
      <Card className="max-w-3xl">
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-md border bg-muted/30">
            <PlugZap className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <CardTitle><ProductTerm term="integration" /> details</CardTitle>
          <CardDescription>Connection and authorization will be available here when setup is enabled.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="integration-name">
              Name
              <input id="integration-name" type="text" placeholder="GitHub" className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="integration-type">
              Provider
              <select id="integration-type" defaultValue="github" className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                <option value="github">GitHub</option>
                <option value="jira">Jira</option>
                <option value="google-workspace">Google Workspace</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="integration-scope">
            <ProductTerm term="scope" />
            <input id="integration-scope" type="text" placeholder="Organization or project scope" className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" />
          </label>
          <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-between">
            <Button variant="ghost" asChild>
              <Link to="/integrations">
                <ArrowLeft data-icon="inline-start" />
                Cancel
              </Link>
            </Button>
            <Button type="button" disabled>
              <Save data-icon="inline-start" />
              Save integration
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
