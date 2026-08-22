import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { CircleDashed, GitBranch, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { WorkflowEventProjection } from '@encois/contracts'
import { InteractiveMiniMap } from '@/components/interactive-minimap'

type WorkflowNodeData = {
  label: string
  description: string
  status: 'completed' | 'running' | 'pending'
  icon: 'blueprint' | 'evidence' | 'provider' | 'synthesis'
}

type WorkflowNode = Node<WorkflowNodeData, 'workflow'>

const nodeTypes = { workflow: WorkflowStepNode }

function normalizeStatus(value: string | undefined, fallback: WorkflowNodeData['status']): WorkflowNodeData['status'] {
  const status = value?.toLowerCase()
  if (status?.includes('running') || status?.includes('started')) return 'running'
  if (status?.includes('complete') || status?.includes('success') || status?.includes('succeed')) return 'completed'
  return fallback
}

function graphFromEvents(events: readonly WorkflowEventProjection[]): { nodes: WorkflowNode[]; edges: Edge[] } {
  const activityEvents = events.filter((event) => event.activityName)
  const uniqueActivities = [...new Map(activityEvents.map((event) => [event.activityName as string, event])).values()]
  const stages = uniqueActivities.length > 0
    ? uniqueActivities.map((event, index) => ({
        id: `activity-${index}`,
        label: event.activityName as string,
        description: typeof event.metadata.provider === 'string' ? event.metadata.provider : 'Activity event',
        status: normalizeStatus(event.status, index === uniqueActivities.length - 1 ? 'running' : 'completed'),
        icon: index === uniqueActivities.length - 1 ? 'synthesis' as const : 'evidence' as const,
      }))
    : [{ id: 'activity-0', label: 'Awaiting activity data', description: 'The run has not emitted step events yet', status: 'pending' as const, icon: 'evidence' as const }]

  const nodes: WorkflowNode[] = [
    {
      id: 'blueprint',
      type: 'workflow',
      position: { x: 0, y: 145 },
      data: { label: 'Blueprint', description: 'Resolved execution definition', status: 'completed', icon: 'blueprint' },
    },
    ...stages.map((stage, index) => ({
      id: stage.id,
      type: 'workflow' as const,
      position: { x: 320 + index * 260, y: 145 },
      data: { label: stage.label, description: stage.description, status: stage.status, icon: stage.icon },
    })),
  ]
  const edges: Edge[] = nodes.slice(0, -1).map((node, index) => ({
    id: `${node.id}-${nodes[index + 1].id}`,
    source: node.id,
    target: nodes[index + 1].id,
    animated: nodes[index + 1].data.status === 'running',
    markerEnd: { type: MarkerType.ArrowClosed },
  }))
  return { nodes, edges }
}

function WorkflowStepNode({ data }: NodeProps<WorkflowNode>) {
  const Icon = nodeIcon[data.icon]
  const statusLabel = statusLabels[data.status]

  return (
    <div className={`workflow-node workflow-node-${data.status}`}>
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-3">
        <div className="workflow-node-icon"><Icon className="size-4" aria-hidden="true" /></div>
        <div className="min-w-0 text-left">
          <p className="truncate text-sm font-medium text-foreground">{data.label}</p>
          <p className="truncate text-xs text-muted-foreground">{data.description}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px] font-medium text-muted-foreground"><span className="workflow-status-dot" aria-hidden="true" />{statusLabel}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeIcon = { blueprint: GitBranch, evidence: CircleDashed, provider: GitBranch, synthesis: Sparkles }
const statusLabels = { completed: 'Completed', running: 'Running now', pending: 'Pending' }

export function WorkflowCanvas({ refreshCount, lastPolledAt, events = [] }: { refreshCount: number; lastPolledAt: Date | null; events?: readonly WorkflowEventProjection[] }) {
  const [isCompact, setIsCompact] = useState(false)
  const graph = useMemo(() => graphFromEvents(events), [events])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 640px)')
    const updateLayout = () => setIsCompact(mediaQuery.matches)
    updateLayout()
    mediaQuery.addEventListener('change', updateLayout)
    return () => mediaQuery.removeEventListener('change', updateLayout)
  }, [])

  const visibleNodes = graph.nodes.map((node, index) => ({
    ...node,
    position: isCompact ? { x: 10, y: index * 120 } : node.position,
  }))

  return (
    <div data-refresh-count={refreshCount} className="workflow-canvas h-[520px] w-full overflow-hidden rounded-lg border bg-muted/10 sm:h-[540px]">
      <ReactFlow
        key={isCompact ? 'compact' : 'desktop'}
        nodes={visibleNodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.28 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.25}
        maxZoom={1.25}
      >
        <Background color="var(--border)" gap={22} size={1} />
        <Controls showInteractive={false} />
        <InteractiveMiniMap nodeColor={(node) => (node.data as WorkflowNodeData).status === 'running' ? 'var(--primary)' : 'var(--muted-foreground)'} />
        <Panel position="top-left">
          <div className="flex flex-col gap-2 rounded-md border bg-background/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
            <div className="flex items-center gap-2"><span className="workflow-live-dot" aria-hidden="true" /><span className="font-medium">Live run topology</span><span className="text-muted-foreground">{lastPolledAt ? `Polled ${lastPolledAt.toLocaleTimeString()}` : 'Waiting for status'}</span></div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground"><span className="flex items-center gap-1.5"><span className="workflow-legend-dot workflow-legend-running" />Running</span><span className="flex items-center gap-1.5"><span className="workflow-legend-dot workflow-legend-pending" />Pending</span></div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}
