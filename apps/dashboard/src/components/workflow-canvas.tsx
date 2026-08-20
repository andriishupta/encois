import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { CircleDashed, GitBranch, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

type WorkflowNodeData = {
  label: string
  description: string
  status: 'completed' | 'running' | 'pending'
  icon: 'release' | 'jira' | 'github' | 'synthesis'
}

type WorkflowNode = Node<WorkflowNodeData, 'workflow'>

const nodes: WorkflowNode[] = [
  {
    id: 'release',
    type: 'workflow',
    position: { x: 0, y: 145 },
    data: {
      label: 'Release',
      description: 'Risk investigation',
      status: 'completed',
      icon: 'release',
    },
  },
  {
    id: 'jira',
    type: 'workflow',
    position: { x: 320, y: 40 },
    data: {
      label: 'Jira assistant',
      description: 'Collecting evidence',
      status: 'running',
      icon: 'jira',
    },
  },
  {
    id: 'github',
    type: 'workflow',
    position: { x: 320, y: 250 },
    data: {
      label: 'GitHub assistant',
      description: 'Collecting activity',
      status: 'running',
      icon: 'github',
    },
  },
  {
    id: 'synthesis',
    type: 'workflow',
    position: { x: 650, y: 145 },
    data: {
      label: 'Risk synthesis',
      description: 'Waiting for evidence',
      status: 'pending',
      icon: 'synthesis',
    },
  },
]

const edges: Edge[] = [
  {
    id: 'release-jira',
    source: 'release',
    target: 'jira',
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  {
    id: 'release-github',
    source: 'release',
    target: 'github',
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  {
    id: 'jira-synthesis',
    source: 'jira',
    target: 'synthesis',
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  {
    id: 'github-synthesis',
    source: 'github',
    target: 'synthesis',
    markerEnd: { type: MarkerType.ArrowClosed },
  },
]

const mobilePositions: Record<string, { x: number; y: number }> = {
  release: { x: 0, y: 145 },
  jira: { x: 175, y: 40 },
  github: { x: 175, y: 250 },
  synthesis: { x: 350, y: 145 },
}

const nodeTypes = { workflow: WorkflowStepNode }

function WorkflowStepNode({ data }: NodeProps<WorkflowNode>) {
  const Icon = nodeIcon[data.icon]
  const statusLabel = statusLabels[data.status]

  return (
    <div className={`workflow-node workflow-node-${data.status}`}>
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-3">
        <div className="workflow-node-icon">
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 text-left">
          <p className="truncate text-sm font-medium text-foreground">{data.label}</p>
          <p className="truncate text-xs text-muted-foreground">{data.description}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
        <span className="workflow-status-dot" aria-hidden="true" />
        {statusLabel}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeIcon = {
  release: GitBranch,
  jira: CircleDashed,
  github: GitBranch,
  synthesis: Sparkles,
}

const statusLabels = {
  completed: 'Completed',
  running: 'Running now',
  pending: 'Pending',
}

export function WorkflowCanvas({ refreshCount, lastPolledAt }: { refreshCount: number; lastPolledAt: Date | null }) {
  const [isCompact, setIsCompact] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 640px)')
    const updateLayout = () => setIsCompact(mediaQuery.matches)

    updateLayout()
    mediaQuery.addEventListener('change', updateLayout)
    return () => mediaQuery.removeEventListener('change', updateLayout)
  }, [])

  const visibleNodes = isCompact
    ? nodes.map((node) => ({ ...node, position: mobilePositions[node.id] }))
    : nodes

  return (
    <div data-refresh-count={refreshCount} className="workflow-canvas h-[520px] w-full overflow-hidden rounded-lg border bg-muted/10 sm:h-[540px]">
      <ReactFlow
        key={isCompact ? 'compact' : 'desktop'}
        nodes={visibleNodes}
        edges={edges}
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
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => {
            const status = (node.data as WorkflowNodeData).status
            return status === 'running' ? 'var(--primary)' : 'var(--muted-foreground)'
          }}
        />
        <Panel position="top-left">
          <div className="flex flex-col gap-2 rounded-md border bg-background/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
            <div className="flex items-center gap-2">
              <span className="workflow-live-dot" aria-hidden="true" />
              <span className="font-medium">Live execution</span>
              <span className="text-muted-foreground">{lastPolledAt ? 'Updated just now' : 'Watching for updates'}</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="workflow-legend-dot workflow-legend-running" />Running</span>
              <span className="flex items-center gap-1.5"><span className="workflow-legend-dot workflow-legend-pending" />Pending</span>
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}
