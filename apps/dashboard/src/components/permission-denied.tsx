import { ShieldAlert } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Card, CardContent } from '@/components/ui/card'

export function PermissionDenied({ title = 'Access restricted', description = 'You do not have permission to view this area.' }: { title?: string; description?: string }) {
  return (
    <Card className="max-w-2xl">
      <CardContent className="pt-6">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
        <h2 className="mt-5 text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <Link to="/" className="mt-6 inline-flex text-sm font-medium underline underline-offset-4">Return to dashboard</Link>
      </CardContent>
    </Card>
  )
}
