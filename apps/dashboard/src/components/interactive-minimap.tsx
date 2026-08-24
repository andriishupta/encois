import { MiniMap, useNodesInitialized, useReactFlow, type MiniMapProps, type Node } from '@xyflow/react'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'

type InteractiveMiniMapProps<NodeType extends Node = Node> = Omit<MiniMapProps<NodeType>, 'onClick'>

// Keep these as concrete CSS colors. MiniMap renders SVG rects, and the
// minimap should remain legible even when a node is disabled or restricted.
export const miniMapColors = {
  default: '#475569',
  editable: '#2563eb',
  selected: '#0f172a',
  restricted: '#64748b',
  stroke: '#64748b',
  failed: '#dc2626',
  partial: '#b45309',
  running: '#2563eb',
  waiting: '#475569',
  pending: '#94a3b8',
} as const

export function FitViewOnContentChange({ contentKey, padding = 0.24 }: { contentKey: string; padding?: number }) {
  const { fitView } = useReactFlow()
  const nodesInitialized = useNodesInitialized()

  useEffect(() => {
    if (!nodesInitialized) return
    void fitView({ padding, duration: 0 })
  }, [contentKey, fitView, nodesInitialized, padding])

  return null
}

export function InteractiveMiniMap<NodeType extends Node = Node>({
  className,
  nodeColor = miniMapColors.default,
  nodeStrokeColor = miniMapColors.stroke,
  nodeStrokeWidth = 1.5,
  nodeBorderRadius = 3,
  maskColor = 'rgba(15, 23, 42, 0.08)',
  maskStrokeColor = 'rgba(15, 23, 42, 0.32)',
  ...props
}: InteractiveMiniMapProps<NodeType>) {
  const { setCenter } = useReactFlow<NodeType>()

  return (
    <MiniMap
      {...props}
      nodeColor={nodeColor}
      nodeStrokeColor={nodeStrokeColor}
      nodeStrokeWidth={nodeStrokeWidth}
      nodeBorderRadius={nodeBorderRadius}
      maskColor={maskColor}
      maskStrokeColor={maskStrokeColor}
      className={cn('react-flow-minimap', className)}
      pannable
      zoomable
      onClick={(_, position) => {
        void setCenter(position.x, position.y, { duration: 220 })
      }}
    />
  )
}
