import type { Renderable } from "@opentui/core"
import { useLayoutEffect } from "react"

import { useTheme } from "../ui/theme"

import {
  focusPathSignature,
  useFocusHaloOverlayController,
  useFocusPath,
  useIsFocusNavigationActive,
  useIsHighlighted,
} from "./context"

export type FocusHaloProps = {
  baseZIndex?: number
  getRenderable?: () => Renderable | null | undefined
  renderable?: Renderable | null
}

export function FocusHalo(props: FocusHaloProps) {
  const theme = useTheme()
  const active = useIsFocusNavigationActive()
  const highlighted = useIsHighlighted()
  const controller = useFocusHaloOverlayController()
  const path = useFocusPath()
  const ownerPathKey = focusPathSignature(path)

  useLayoutEffect(() => {
    if (!ownerPathKey) {
      return
    }

    if (!active || !highlighted) {
      controller.clearTarget(ownerPathKey)
      return
    }

    const renderable = props.getRenderable?.() ?? props.renderable
    if (!renderable || renderable.isDestroyed) {
      controller.clearTarget(ownerPathKey)
      return
    }

    controller.setTarget({
      backgroundColor: theme.focusNavHaloBg,
      ownerPathKey,
      renderable,
      zIndex: Math.max((renderable.zIndex ?? props.baseZIndex ?? 0) + 1, 1),
    })

    return () => {
      controller.clearTarget(ownerPathKey)
    }
  }, [
    active,
    controller,
    highlighted,
    ownerPathKey,
    props.baseZIndex,
    props.getRenderable,
    props.renderable,
    theme.focusNavHaloBg,
  ])

  return null
}
