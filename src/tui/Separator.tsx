import type { MouseEvent } from "@opentui/core"
import { useState } from "react"

type SeparatorProps = {
  direction: "horizontal" | "vertical"
  dragging?: boolean
  onDragStart: (e: MouseEvent) => void
}

const COLOR_DEFAULT = "#555555"
const COLOR_HOVER = "#aaaaaa"

export function Separator({ direction, dragging, onDragStart }: SeparatorProps) {
  const [hovered, setHovered] = useState(false)
  const color = dragging || hovered ? COLOR_HOVER : COLOR_DEFAULT

  if (direction === "vertical") {
    return (
      <box
        width={1}
        border={["left"]}
        borderStyle="single"
        borderColor={color}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseDown={onDragStart}
      />
    )
  }

  return (
    <box
      height={1}
      border={["top"]}
      borderStyle="single"
      borderColor={color}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={onDragStart}
    />
  )
}
