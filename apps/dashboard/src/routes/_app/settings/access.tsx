import { createFileRoute, Link } from '@tanstack/react-router'
import { Check, LockKeyhole, ShieldCheck, Users } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/_app/settings/access')({
  component: AccessSettingsPage,
})

function AccessSettingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Access" description="Organization membership and information boundaries." actions={<Button type="button" variant="outline" asChild><Link to="/organization/permissions"><LockKeyhole data-icon="inline-start" />Open permission board</Link></Button>} />
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" aria-hidden="true" />Organization membership</CardTitle><CardDescription>People who can access this workspace.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <MemberRow initials="AM" name="Alex Morgan" email="alex@acme.com" role="Owner" />
            <MemberRow initials="JD" name="Jamie Davis" email="jamie@acme.com" role="Member" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><LockKeyhole className="size-4 text-muted-foreground" aria-hidden="true" />Information boundaries</CardTitle><CardDescription>What the <ProductTerm term="coordinator" /> can access in this <ProductTerm term="scope" />.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {['Organization scope enforced', 'Read-only provider access', 'Evidence stays linked to source and timestamp'].map((item) => <div key={item} className="flex items-center gap-3 rounded-lg border px-3 py-3 text-sm"><span className="flex size-6 items-center justify-center rounded-full bg-muted"><Check className="size-3.5 text-muted-foreground" aria-hidden="true" /></span>{item}</div>)}
            <div className="mt-2 flex items-start gap-3 rounded-lg border bg-muted/20 p-3 text-sm"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="text-muted-foreground">Writes and provider credentials remain outside the browser.</span></div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MemberRow({ initials, name, email, role }: { initials: string; name: string; email: string; role: string }) {
  return <div className="flex items-center gap-3 rounded-lg border p-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{initials}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{name}</p><p className="truncate text-xs text-muted-foreground">{email}</p></div><span className="rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">{role}</span></div>
}
