import { useState } from 'react'
import { ContractVersion, TemporalWorkflowType, WorkflowStepKind, type WorkflowStartRequest } from '@encois/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Save } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { startWorkflow } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export const Route = createFileRoute('/_app/workflows/new')({
  component: NewWorkflowPage,
})

function NewWorkflowPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [projectKey, setProjectKey] = useState('DEMO')
  const [workflowKey, setWorkflowKey] = useState('project-context-demo')
  const mutation = useMutation({
    mutationFn: () => {
      const request: WorkflowStartRequest = {
        workflowType: TemporalWorkflowType.UserBlueprint,
        key: workflowKey,
        input: { projectKey },
        blueprint: {
          contractVersion: ContractVersion.WorkflowBlueprint,
          blueprintId: 'project-context',
          version: '1.0.0',
          name: 'Project context',
          workflowType: TemporalWorkflowType.UserBlueprint,
          purpose: 'Collect project context and produce an evidence-linked summary.',
          enabled: true,
          steps: [
            { id: 'source', kind: WorkflowStepKind.Tool, tool: 'jira.project_tasks' },
            { id: 'summary', kind: WorkflowStepKind.Agent, agentDefinition: 'context.synthesizer@1', dependsOn: ['source'] },
          ],
        },
      }
      return startWorkflow(request)
    },
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workflows() })
      await navigate({ to: '/workflows/$workflowId', params: { workflowId: response.workflowId } })
    },
  })

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="New workflow" description={<>Start a generic <ProductTerm term="blueprint" /> execution through the Gateway API.</>} />
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle><ProductTerm term="workflow" /> details</CardTitle>
          <CardDescription>Creates a generic <ProductTerm term="blueprint" /> execution. The same key reuses the active <ProductTerm term="workflow" />.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="project-key">
              Project key
              <input id="project-key" value={projectKey} onChange={(event) => setProjectKey(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 font-mono text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="workflow-key">
              Workflow key
              <input id="workflow-key" value={workflowKey} onChange={(event) => setWorkflowKey(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 font-mono text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" />
            </label>
          </div>
          {mutation.isError ? <p className="text-sm text-destructive">Could not start workflow: {mutation.error.message}</p> : null}
          <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-between">
            <Button variant="ghost" asChild>
              <Link to="/workflows">
                <ArrowLeft data-icon="inline-start" />
                Cancel
              </Link>
            </Button>
            <Button type="button" disabled={mutation.isPending || !projectKey.trim() || !workflowKey.trim()} onClick={() => mutation.mutate()}>
              <Save data-icon="inline-start" />
              {mutation.isPending ? 'Starting…' : 'Start workflow'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
