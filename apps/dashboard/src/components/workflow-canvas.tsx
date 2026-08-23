import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { CircleDashed, GitBranch, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { WorkflowEventProjection, WorkflowExecutionStatus } from '@encois/contracts'
import { InteractiveMiniMap, miniMapColors } from '@/components/interactive-minimap'
import { WorkflowStatusIndicator } from '@/components/workflow-status'
import { getWorkflowCanvasStages, type WorkflowNodeStatus } from '@/lib/workflow-canvas-model'

type WorkflowNodeData = {
  label: string
  description: string
  status: WorkflowNodeStatus
  icon: 'blueprint' | 'evidence' | 'provider' | 'synthesis'
}

type WorkflowNode = Node<WorkflowNodeData, 'workflow'>

const terminalRunStatuses: ReadonlySet<WorkflowExecutionStatus> = new Set(['completed', 'failed', 'partial', 'cancelled'])

function graphFromEvents(events: readonly WorkflowEventProjection[], runStatus?: WorkflowExecutionStatus): { nodes: WorkflowNode[]; edges: Edge[] } {
  const stages = getWorkflowCanvasStages(events, runStatus)

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
      <div className="mt-3"><WorkflowStatusIndicator status={data.status} compact /></div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeIcon = { blueprint: GitBranch, evidence: CircleDashed, provider: GitBranch, synthesis: Sparkles }
const statusColors: Record<WorkflowNodeStatus, string> = {
  completed: miniMapColors.default,
  running: miniMapColors.running,
  pending: miniMapColors.pending,
  waiting: miniMapColors.waiting,
  paused: miniMapColors.waiting,
  partial: miniMapColors.partial,
  failed: miniMapColors.failed,
  cancelled: miniMapColors.pending,
}

export function WorkflowCanvas({ refreshCount, lastPolledAt, events = [], runStatus }: { refreshCount: number; lastPolledAt: Date | null; events?: readonly WorkflowEventProjection[]; runStatus?: WorkflowExecutionStatus }) {
  const [isCompact, setIsCompact] = useState(false)
  const graph = useMemo(() => graphFromEvents(events, runStatus), [events, runStatus])
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>(graph.nodes)
  const nodeTypes = useMemo(() => ({ workflow: WorkflowStepNode }), [])
  const isLive = !runStatus || !terminalRunStatuses.has(runStatus)

  useEffect(() => {
    setNodes(graph.nodes)
  }, [graph.nodes, setNodes])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 640px)')
    const updateLayout = () => setIsCompact(mediaQuery.matches)
    updateLayout()
    mediaQuery.addEventListener('change', updateLayout)
    return () => mediaQuery.removeEventListener('change', updateLayout)
  }, [])

  const visibleNodes = nodes.map((node, index) => ({
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
        onNodesChange={onNodesChange}
        fitView
        fitViewOptions={{ padding: 0.28 }}
        nodesDraggable
        deleteKeyCode={null}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.25}
        maxZoom={1.25}
      >
        <Background color="var(--border)" gap={22} size={1} />
        <Controls showInteractive={false} />
        <InteractiveMiniMap nodeColor={(node) => statusColors[(node.data as WorkflowNodeData).status]} />
        <Panel position="top-left">
          <div className="flex flex-col gap-2 rounded-md border bg-background/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
            <div className="flex items-center gap-2"><span className={isLive ? 'workflow-live-dot' : 'workflow-status-dot'} aria-hidden="true" /><span className="font-medium">{isLive ? 'Live run topology' : 'Run topology'}</span><span className="text-muted-foreground">{lastPolledAt ? `Polled ${lastPolledAt.toLocaleTimeString()}` : 'Waiting for status'}</span></div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><WorkflowStatusIndicator status="running" compact /><WorkflowStatusIndicator status="waiting" compact /><WorkflowStatusIndicator status="failed" compact /><WorkflowStatusIndicator status="pending" compact /></div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}
