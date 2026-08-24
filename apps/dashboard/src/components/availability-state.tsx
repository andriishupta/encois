import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export const unavailableCardClassName = 'cursor-help border-muted bg-card opacity-[0.85] shadow-xs'

export function AvailabilityBadge({ label = 'Coming Soon' }: { label?: string }) {
  return <span className="inline-flex shrink-0 items-center rounded-full border border-muted-foreground/20 bg-muted px-2 py-1 text-[10px] font-semibold uppercase tracking-wide leading-none text-muted-foreground">{label}</span>
}

export function AvailabilityCard({ label = 'Coming Soon', children, className }: { label?: string; children: ReactNode; className?: string }) {
  return <Card aria-disabled="true" title={label} className={cn(unavailableCardClassName, className)}>{children}</Card>
}
