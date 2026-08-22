import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, CircleAlert, Trash2 } from 'lucide-react'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { deleteSavedInvestigation, listSavedInvestigations } from '@/lib/api'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { Permission } from '@encois/contracts'
import { queryKeys } from '@/lib/query-keys'
import { formatDate } from '@/lib/formatters'

export const Route = createFileRoute('/_app/investigations')({
  beforeLoad: () => {
    const session = getAuthSession()
    if (!hasPermission(session, Permission.OrganizationManage) && !hasPermission(session, Permission.WorkflowsRead) && !hasPermission(session, Permission.KnowledgeRead) && !hasPermission(session, Permission.ContextRead) && !hasPermission(session, Permission.MemoryRead)) throw redirect({ to: '/forbidden' })
  },
  component: InvestigationsPage,
})

function InvestigationsPage() {
  const queryClient = useQueryClient()
  const investigations = useQuery({ queryKey: queryKeys.savedInvestigations(), queryFn: listSavedInvestigations })
  const remove = useMutation({ mutationFn: (id: string) => deleteSavedInvestigation(id), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.savedInvestigations() }) } })
  return <div className="flex flex-col gap-8"><PageHeader title="Saved investigations" description="Repeatable, scope-bound entry points into project context, memory, and workflow review." actions={<Button asChild variant="outline"><Link to="/context">Open project context</Link></Button>} />{investigations.isError ? <Card><CardContent className="flex items-start gap-3 pt-6 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4" />Could not load saved investigations: {investigations.error.message}</CardContent></Card> : null}{investigations.isLoading ? <p className="text-sm text-muted-foreground">Loading saved investigations…</p> : null}{!investigations.isLoading && !investigations.isError && !investigations.data?.length ? <Card><CardContent className="pt-6"><EmptyPanel icon={Bookmark} title="No saved investigations" description="Save a bounded query from project context to make it available here." action={<Button asChild><Link to="/context">Explore project context</Link></Button>} /></CardContent></Card> : null}<div className="grid gap-4 md:grid-cols-2">{investigations.data?.map((item) => <Card key={item.id}><CardHeader><CardTitle className="flex items-center justify-between gap-3"><span className="truncate">{item.name}</span><span className="rounded-full bg-secondary px-2 py-1 text-[11px] font-normal">{item.kind}</span></CardTitle><CardDescription>{item.query} · updated {formatDate(item.updatedAt)}</CardDescription></CardHeader><CardContent className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">Scope: {item.scope.ids.join(', ')}</span><Button type="button" variant="ghost" size="icon" aria-label={`Delete ${item.name}`} onClick={() => remove.mutate(item.id)} disabled={remove.isPending}><Trash2 className="size-4" /></Button></CardContent></Card>)}</div></div>
}
