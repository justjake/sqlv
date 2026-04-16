import type { MouseEvent } from "@opentui/core"
import { useState } from "react"
import { useTheme } from "./ui/theme"

type SeparatorProps = {
  direction: "horizontal" | "vertical"
  dragging?: boolean
  onDragStart: (e: MouseEvent) => void
}

export function Separator({ direction, dragging, onDragStart }: SeparatorProps) {
  const [hovered, setHovered] = useState(false)
  const theme = useTheme()
  const color = dragging || hovered ? theme.borderHoverColor : theme.borderColor

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
