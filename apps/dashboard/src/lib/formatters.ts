import { WorkflowExecutionStatus, type WorkflowStatusReason } from '@encois/contracts'

export function humanizeKey(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function workflowLabel(blueprintId?: string, workflowType?: string): string {
  const source = blueprintId || workflowType || 'Workflow run'
  return humanizeKey(source.replace(/-blueprint$/u, ''))
}

export function workflowStatusLabel(status: WorkflowExecutionStatus, reason?: WorkflowStatusReason): string {
  const label = humanizeKey(status)
  return reason ? `${label} · ${humanizeKey(reason)}` : label
}

export function formatDate(value?: string): string {
  if (!value) return 'Time unavailable'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Time unavailable' : date.toLocaleString()
}

export function shortIdentifier(value: string, visibleCharacters = 12): string {
  if (value.length <= visibleCharacters) return value
  const edge = Math.max(4, Math.floor((visibleCharacters - 1) / 2))
  return `${value.slice(0, edge)}…${value.slice(-edge)}`
}
