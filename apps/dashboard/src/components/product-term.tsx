import { useSyncExternalStore } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type ProductTermKey =
  | 'coordinator'
  | 'knowledgeSource'
  | 'workflow'
  | 'blueprint'
  | 'evidence'
  | 'scope'
  | 'organizationUnit'
  | 'integration'
  | 'ingestion'
  | 'revision'
  | 'signal'
  | 'template'
  | 'run'
  | 'plan'
  | 'graph'
  | 'memory'
  | 'activity'
  | 'event'
  | 'workflowStep'
  | 'agentRun'
  | 'provenance'
  | 'freshness'
  | 'investigation'
  | 'tool'
  | 'agentDefinition'
  | 'memoryBank'
  | 'query'
  | 'workflowInstance'
  | 'approvalBoundary'
  | 'partialResult'
  | 'businessPause'

const productTerms: Record<ProductTermKey, { label: string; pluralLabel: string; description: string }> = {
  coordinator: {
    label: 'Coordinator',
    pluralLabel: 'Coordinators',
    description: 'The read-only agent that gathers context and proposes what this workspace should investigate next.',
  },
  knowledgeSource: {
    label: 'Knowledge source',
    pluralLabel: 'Knowledge sources',
    description: 'A scoped origin of organization context, such as an integration, document, or manual update.',
  },
  workflow: {
    label: 'Workflow',
    pluralLabel: 'Workflows',
    description: 'A repeatable sequence of checks that this workspace runs to investigate an organization signal.',
  },
  blueprint: {
    label: 'Blueprint',
    pluralLabel: 'Blueprints',
    description: 'A versioned definition of a workflow, including its purpose, steps, and dependencies.',
  },
  evidence: {
    label: 'Evidence',
    pluralLabel: 'Evidence',
    description: 'A source-backed record that explains why an insight or workflow result exists.',
  },
  scope: {
    label: 'Scope',
    pluralLabel: 'Scopes',
    description: 'The part of your organization that a member, source, or workflow can read.',
  },
  organizationUnit: {
    label: 'Organization unit',
    pluralLabel: 'Organization units',
    description: 'A company, department, team, project, or service boundary used to organize access and context.',
  },
  integration: {
    label: 'Integration',
    pluralLabel: 'Integrations',
    description: 'A connected provider such as GitHub, Jira, Slack, or Linear.',
  },
  ingestion: {
    label: 'Ingestion',
    pluralLabel: 'Ingestion',
    description: 'The process that reads a source revision, validates it, and prepares facts for this workspace.',
  },
  revision: {
    label: 'Revision',
    pluralLabel: 'Revisions',
    description: 'An immutable snapshot of a knowledge source at a point in time.',
  },
  signal: {
    label: 'Signal',
    pluralLabel: 'Signals',
    description: 'An event or change that may need investigation, such as a blocker, deployment issue, or stale work.',
  },
  template: {
    label: 'Template',
    pluralLabel: 'Templates',
    description: 'A reusable starting point for a workflow. Templates are not execution records and do not contain tenant-specific state.',
  },
  run: {
    label: 'Run',
    pluralLabel: 'Runs',
    description: 'One execution of a workflow with its own status, events, evidence, and audit trail.',
  },
  plan: {
    label: 'Change plan',
    pluralLabel: 'Change plans',
    description: 'A reviewable proposal that describes a Blueprint change before it is approved and applied.',
  },
  graph: {
    label: 'Organization memory graph',
    pluralLabel: 'Organization memory graphs',
    description: 'A relationship view of organization units, systems, people, and evidence used to explain an investigation.',
  },
  memory: {
    label: 'Memory',
    pluralLabel: 'Memory',
    description: 'Scoped distilled context available to authorized workflows. It is inspectable product state, not hidden model reasoning.',
  },
  activity: {
    label: 'Activity',
    pluralLabel: 'Activities',
    description: 'A bounded operation performed by a Worker on behalf of a Workflow, such as reading evidence or invoking an approved tool.',
  },
  event: {
    label: 'Execution event',
    pluralLabel: 'Execution events',
    description: 'A durable lifecycle record for a Workflow Run, including state transitions, signals, and outcomes.',
  },
  workflowStep: {
    label: 'Workflow step',
    pluralLabel: 'Workflow steps',
    description: 'A typed unit in a Blueprint that describes one stage of a Workflow execution.',
  },
  agentRun: {
    label: 'Agent Run',
    pluralLabel: 'Agent Runs',
    description: 'One bounded execution of an agent definition inside a Workflow Run, with its own trace and evidence links.',
  },
  provenance: {
    label: 'Provenance',
    pluralLabel: 'Provenance',
    description: 'The source, scope, timestamps, and transformation details that explain where a fact or result came from.',
  },
  freshness: {
    label: 'Freshness',
    pluralLabel: 'Freshness',
    description: 'Metadata describing how current a source fact or evidence record is and when it should be reviewed again.',
  },
  investigation: {
    label: 'Investigation',
    pluralLabel: 'Investigations',
    description: 'A bounded review that combines a scoped query, context, evidence, and an explainable result.',
  },
  tool: {
    label: 'Tool',
    pluralLabel: 'Tools',
    description: 'An allowlisted capability an agent may invoke with an explicit scope, schema, and side-effect policy.',
  },
  agentDefinition: {
    label: 'Agent Definition',
    pluralLabel: 'Agent Definitions',
    description: 'An approved, versioned agent role with bounded tools, input/output schemas, scope, model, retry, and budget policy.',
  },
  memoryBank: {
    label: 'Workflow memory',
    pluralLabel: 'Workflow memory',
    description: 'Scoped memory associated with workflow and agent execution. It is not the organization graph or an authorization store.',
  },
  query: {
    label: 'Query',
    pluralLabel: 'Queries',
    description: 'A read-only request for a current graph, memory, or Workflow state. Queries do not mutate execution.',
  },
  workflowInstance: {
    label: 'Workflow instance',
    pluralLabel: 'Workflow instances',
    description: 'One running or completed execution of a Workflow definition with a specific input and state history.',
  },
  approvalBoundary: {
    label: 'Approval boundary',
    pluralLabel: 'Approval boundaries',
    description: 'The explicit point where an authorized user or policy must approve a sensitive change or external write.',
  },
  partialResult: {
    label: 'Partial result',
    pluralLabel: 'Partial results',
    description: 'A usable result produced from available evidence while one or more bounded sources failed or remain stale.',
  },
  businessPause: {
    label: 'Business pause',
    pluralLabel: 'Business pauses',
    description: 'A normal Workflow state that waits for input or an external event; it is not necessarily a failure.',
  },
}

export const productTooltipStorageKey = 'encois.ui.product-tooltips.v1'
const productTooltipEventName = 'encois:product-tooltips-changed'

function readProductTooltipsEnabled() {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(productTooltipStorageKey) !== 'false'
  } catch {
    return true
  }
}

function subscribeToProductTooltipPreference(onChange: () => void) {
  window.addEventListener(productTooltipEventName, onChange)
  return () => window.removeEventListener(productTooltipEventName, onChange)
}

export function useProductTooltipsEnabled() {
  return useSyncExternalStore(subscribeToProductTooltipPreference, readProductTooltipsEnabled, () => true)
}

export function setProductTooltipsEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(productTooltipStorageKey, String(enabled))
  } catch {
    // The preference remains enabled for this render when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(productTooltipEventName))
}

export function ProductTerm({ term, plural = false, className }: { term: ProductTermKey; plural?: boolean; className?: string }) {
  const enabled = useProductTooltipsEnabled()
  const definition = productTerms[term]
  const label = plural ? definition.pluralLabel : definition.label

  if (!enabled) return <span className={className}>{label}</span>

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn('cursor-help border-b border-dotted border-current/60', className)}
            tabIndex={0}
            aria-label={`${label}. ${definition.description}`}
          >
            {label}
          </span>
        }
      />
      <TooltipContent align="start">{definition.description}</TooltipContent>
    </Tooltip>
  )
}
