import { useEffect, useMemo } from 'react'
import { Background, Controls, MarkerType, Panel, ReactFlow, useNodesState, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { GraphInspectionProjection, GraphNode } from '@encois/contracts'
import { InteractiveMiniMap } from '@/components/interactive-minimap'

function nodeLabel(node: GraphNode): string {
  const properties = node.properties
  for (const key of ['name', 'title', 'summary', 'label']) {
    if (typeof properties[key] === 'string' && properties[key]) return properties[key] as string
  }
  return node.id
}

export function ContextGraphCanvas({ graph, onSelect }: { graph: GraphInspectionProjection; onSelect: (node: GraphNode) => void }) {
  const layoutNodes = useMemo<Node[]>(() => graph.nodes.map((node, index) => ({
    id: node.id,
    position: { x: (index % 3) * 290, y: Math.floor(index / 3) * 185 },
    data: { label: <button type="button" className="w-full text-left" onClick={() => onSelect(node)}><span className="block truncate text-sm font-medium">{nodeLabel(node)}</span><span className="mt-1 block text-[11px] text-muted-foreground">{node.type}</span></button> },
    style: { width: 208, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--background)', padding: 12, boxShadow: '0 1px 2px color-mix(in oklab, var(--foreground) 8%, transparent)' },
  })), [graph.nodes, onSelect])
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(layoutNodes)

  useEffect(() => {
    setNodes(layoutNodes)
  }, [layoutNodes, setNodes])

  const edges = useMemo<Edge[]>(() => graph.edges
    .filter((edge) => graph.nodes.some((node) => node.id === edge.sourceId) && graph.nodes.some((node) => node.id === edge.targetId))
    .map((edge) => ({ id: edge.id, source: edge.sourceId, target: edge.targetId, label: edge.relationship, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed }, labelStyle: { fontSize: 10, fill: 'var(--muted-foreground)' }, labelBgStyle: { fill: 'var(--background)' }, labelBgPadding: [4, 2], labelBgBorderRadius: 4 })), [graph.edges, graph.nodes])

  return <div className="h-[560px] overflow-hidden rounded-xl border bg-muted/10">
    <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} fitView fitViewOptions={{ padding: 0.25 }} nodesDraggable nodesConnectable={false} deleteKeyCode={null} proOptions={{ hideAttribution: true }} minZoom={0.25} maxZoom={1.3}>
      <Background color="var(--border)" gap={22} size={1} />
      <Controls showInteractive={false} />
      <InteractiveMiniMap />
      <Panel position="top-left"><div className="rounded-md border bg-background/95 px-3 py-2 text-xs shadow-sm backdrop-blur"><span className="font-medium">Context projection</span><span className="ml-2 text-muted-foreground">{graph.nodes.length} nodes · {graph.edges.length} edges</span></div></Panel>
    </ReactFlow>
  </div>
}
