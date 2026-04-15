import type { Renderable } from "@opentui/core"
import { useTheme } from "../ui/theme"
import { useIsFocusNavigationActive, useIsHighlighted } from "./context"

export type FocusHaloProps = {
  baseZIndex?: number
  renderable?: Renderable | null
}

export function FocusHalo(props: FocusHaloProps) {
  const theme = useTheme()
  const active = useIsFocusNavigationActive()
  const highlighted = useIsHighlighted()

  if (!active || !highlighted) {
    return null
  }

  return (
    <box
      backgroundColor={theme.focusNavHaloBg}
      bottom={0}
      left={0}
      position="absolute"
      right={0}
      top={0}
      zIndex={Math.max((props.renderable?.zIndex ?? props.baseZIndex ?? 0) + 1, 1)}
    />
  )
}
