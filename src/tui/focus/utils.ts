import type { Renderable, ScrollBoxRenderable } from "@opentui/core"
import type { FocusPath, FocusRect, FocusVisibleRect } from "../../lib/focus/types"

const FOCUS_RENDERABLE_PREFIX = "focus:"

export function focusableRenderableId(path: FocusPath): string {
  return `${FOCUS_RENDERABLE_PREFIX}${path.map((segment) => encodeURIComponent(segment)).join("/")}`
}

export const focusNavigableRenderableId = focusableRenderableId

export function renderableViewportRect(renderable: Renderable | null | undefined): FocusVisibleRect {
  if (!renderable || renderable.isDestroyed || !renderable.visible) {
    return null
  }

  const width = Math.max(0, renderable.width)
  const height = Math.max(0, renderable.height)
  if (width <= 0 || height <= 0) {
    return null
  }

  return {
    x: renderable.x,
    y: renderable.y,
    width,
    height,
  } satisfies FocusRect
}

export function scrollViewportRect(scrollbox: ScrollBoxRenderable | null | undefined): FocusVisibleRect {
  return renderableViewportRect(scrollbox?.viewport)
}
