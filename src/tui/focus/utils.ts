import type { Renderable, ScrollBoxRenderable } from "@opentui/core"
import type { FocusNavigablePath, FocusRect, FocusVisibleRect } from "../../lib/focus"

const FOCUS_RENDERABLE_PREFIX = "focus-nav:"

export function focusNavigableRenderableId(path: FocusNavigablePath): string {
  return `${FOCUS_RENDERABLE_PREFIX}${path.map((segment) => encodeURIComponent(segment)).join("/")}`
}

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
