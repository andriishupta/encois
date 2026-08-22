import { MiniMap, useReactFlow, type MiniMapProps, type Node } from '@xyflow/react'
import { cn } from '@/lib/utils'

type InteractiveMiniMapProps<NodeType extends Node = Node> = Omit<MiniMapProps<NodeType>, 'onClick'>

export function InteractiveMiniMap<NodeType extends Node = Node>({ className, ...props }: InteractiveMiniMapProps<NodeType>) {
  const { setCenter } = useReactFlow<NodeType>()

  return (
    <MiniMap
      {...props}
      className={cn('react-flow-minimap', className)}
      pannable
      zoomable
      onClick={(_, position) => {
        void setCenter(position.x, position.y, { duration: 220 })
      }}
    />
  )
}
