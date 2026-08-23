import { useMemo } from 'react'
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
import { Building2, FolderKanban, Layers3, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InteractiveMiniMap } from '@/components/interactive-minimap'
import { humanizeUnitType, type OrganizationUnit, type OrganizationUnitType } from '@/lib/organization'

type OrganizationNodeData = {
  unit: OrganizationUnit
  selected: boolean
  onSelect: (unitId: string) => void
}

type OrganizationNode = Node<OrganizationNodeData, 'organization'>

const nodeWidth = 208
const horizontalGap = 84
const verticalGap = 185

function getNodePositions(units: readonly OrganizationUnit[]): Map<string, { x: number; y: number }> {
  const children = new Map<string | null, OrganizationUnit[]>()
  for (const unit of units) children.set(unit.parentId, [...(children.get(unit.parentId) ?? []), unit])

  const subtreeWidths = new Map<string, number>()
  function measure(unitId: string): number {
    const childUnits = children.get(unitId) ?? []
    const childWidth = childUnits.reduce((total, child, index) => total + measure(child.id) + (index > 0 ? horizontalGap : 0), 0)
    const width = Math.max(nodeWidth, childWidth)
    subtreeWidths.set(unitId, width)
    return width
  }

  const roots = children.get(null) ?? []
  const rootWidth = roots.reduce((total, root, index) => total + measure(root.id) + (index > 0 ? horizontalGap : 0), 0)
  const positions = new Map<string, { x: number; y: number }>()

  function place(unit: OrganizationUnit, left: number, depth: number): void {
    const width = subtreeWidths.get(unit.id) ?? nodeWidth
    const childUnits = children.get(unit.id) ?? []
    positions.set(unit.id, { x: left + (width - nodeWidth) / 2, y: depth * verticalGap })

    const childrenWidth = childUnits.reduce((total, child, index) => total + (subtreeWidths.get(child.id) ?? nodeWidth) + (index > 0 ? horizontalGap : 0), 0)
    let childLeft = left + (width - childrenWidth) / 2
    for (const child of childUnits) {
      place(child, childLeft, depth + 1)
      childLeft += (subtreeWidths.get(child.id) ?? nodeWidth) + horizontalGap
    }
  }

  let rootLeft = Math.max(0, (Math.max(nodeWidth, rootWidth) - rootWidth) / 2)
  for (const root of roots) {
    place(root, rootLeft, 0)
    rootLeft += (subtreeWidths.get(root.id) ?? nodeWidth) + horizontalGap
  }

  return positions
}

const unitIcon: Record<OrganizationUnitType, typeof Building2> = {
  organization: Building2,
  department: Layers3,
  team: Users,
  project: FolderKanban,
  service: FolderKanban,
  custom: FolderKanban,
}

function OrganizationUnitNode({ data }: NodeProps<OrganizationNode>) {
  const Icon = unitIcon[data.unit.type]

  return (
    <button
      type="button"
      className={cn(
        'w-52 rounded-xl border bg-background p-3 text-left shadow-sm transition-colors hover:border-foreground/40',
        data.selected && 'border-primary ring-2 ring-primary/20',
      )}
      onClick={(event) => { event.stopPropagation(); data.onSelect(data.unit.id) }}
    >
      <Handle type="target" position={Position.Top} className="!h-0 !w-0 !border-0 !bg-transparent" />
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{data.unit.name}</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">{humanizeUnitType(data.unit.type)}</span>
        </span>
      </div>
      <span className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Users className="size-3.5" aria-hidden="true" />
        {data.unit.memberCount} members · {data.unit.manager}
      </span>
      <Handle type="source" position={Position.Bottom} className="!h-0 !w-0 !border-0 !bg-transparent" />
    </button>
  )
}

const nodeTypes = { organization: OrganizationUnitNode }

export function OrganizationCanvas({ units, selectedUnitId, onSelectUnit }: { units: readonly OrganizationUnit[]; selectedUnitId: string; onSelectUnit: (unitId: string) => void }) {
  const nodes = useMemo<OrganizationNode[]>(() => {
    const positions = getNodePositions(units)
    return units.map((unit) => ({
      id: unit.id,
      type: 'organization',
      position: positions.get(unit.id) ?? { x: 0, y: 0 },
      data: { unit, selected: unit.id === selectedUnitId, onSelect: onSelectUnit },
    }))
  }, [onSelectUnit, selectedUnitId, units])

  const edges = useMemo<Edge[]>(() => units.flatMap((unit) => unit.parentId ? [{
    id: `${unit.parentId}-${unit.id}`,
    source: unit.parentId,
    target: unit.id,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed },
  }] : []), [units])

  return (
    <div className="h-[570px] w-full overflow-hidden rounded-xl border bg-muted/10 sm:h-[640px]">
      <ReactFlow
        key={units.map((unit) => unit.id).join('|')}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelectUnit(node.id)}
        fitView
        fitViewOptions={{ padding: 0.24 }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.25}
        maxZoom={1.15}
      >
        <Background color="var(--border)" gap={22} size={1} />
        <Controls showInteractive={false} />
        <InteractiveMiniMap
          nodeColor={(node) => node.id === selectedUnitId ? 'var(--primary)' : 'var(--muted-foreground)'}
        />
        <Panel position="top-left">
          <div className="flex items-center gap-2 rounded-md border bg-background/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
            <Building2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="font-medium">Organization structure</span>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}
