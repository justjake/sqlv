import type { BoxRenderable, Renderable, ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react"
import { focusPath, type FocusAreaRegistration, type FocusNavigablePath } from "../../lib/focus"
import { FocusParentPathProvider, useFocusParentPath, useFocusTree } from "./context"
import { focusNavigableRenderableId, renderableViewportRect, scrollViewportRect } from "./utils"

type BoxProps = {
  [key: string]: unknown
}

type ScrollSnapshot = {
  left: number
  top: number
}

export type FocusNavigableAreaProps = Omit<BoxProps, "children" | "onMouseDown" | "ref"> & {
  children: ReactNode
  focusNavigableId: string
  trap?: boolean
  onEsc?: () => void
  onEscLabel?: string
  renderableRef?: RefObject<Renderable | null>
  scrollRef?: RefObject<ScrollBoxRenderable | null>
  revealDescendant?: FocusAreaRegistration["revealDescendant"]
  captureFocusNavigationSnapshot?: FocusAreaRegistration["captureFocusNavigationSnapshot"]
  restoreFocusNavigationSnapshot?: FocusAreaRegistration["restoreFocusNavigationSnapshot"]
}

export function FocusNavigableArea(props: FocusNavigableAreaProps) {
  const {
    captureFocusNavigationSnapshot,
    children,
    focusNavigableId,
    onEsc,
    onEscLabel,
    renderableRef,
    restoreFocusNavigationSnapshot,
    revealDescendant,
    scrollRef,
    trap,
    ...boxProps
  } = props
  const tree = useFocusTree()
  const parentPath = useFocusParentPath()
  const wrapperRef = useRef<BoxRenderable>(null)
  const path = useMemo(() => focusPath(parentPath, focusNavigableId), [focusNavigableId, parentPath]) satisfies FocusNavigablePath
  const onEscRef = useRef(onEsc)
  const renderableTargetRef = useRef(renderableRef)
  const scrollTargetRef = useRef(scrollRef)
  const revealDescendantRef = useRef(revealDescendant)
  const captureSnapshotRef = useRef(captureFocusNavigationSnapshot)
  const restoreSnapshotRef = useRef(restoreFocusNavigationSnapshot)

  onEscRef.current = onEsc
  renderableTargetRef.current = renderableRef
  scrollTargetRef.current = scrollRef
  revealDescendantRef.current = revealDescendant
  captureSnapshotRef.current = captureFocusNavigationSnapshot
  restoreSnapshotRef.current = restoreFocusNavigationSnapshot

  useEffect(() => {
    tree.registerArea({
      id: focusNavigableId,
      parentPath,
      trap,
      onEsc: () => onEscRef.current?.(),
      onEscLabel,
      getViewportRect: () => areaViewportRect(renderableTargetRef.current?.current ?? wrapperRef.current, scrollTargetRef.current?.current),
      getViewportClipRect: () => areaClipRect(renderableTargetRef.current?.current ?? wrapperRef.current, scrollTargetRef.current?.current),
      revealDescendant: (descendantPath, options) => {
        const reveal = revealDescendantRef.current ?? makeScrollReveal(scrollTargetRef.current)
        reveal?.(descendantPath, options)
      },
      captureFocusNavigationSnapshot: () =>
        (captureSnapshotRef.current ?? makeScrollSnapshotCapture(scrollTargetRef.current))?.(),
      restoreFocusNavigationSnapshot: (snapshot) =>
        (restoreSnapshotRef.current ?? makeScrollSnapshotRestore(scrollTargetRef.current))?.(snapshot),
    })

    return () => {
      tree.unregisterArea(path)
    }
  }, [focusNavigableId, parentPath, path, tree])

  useEffect(() => {
    tree.updateArea(path, {
      trap,
      onEsc: () => onEscRef.current?.(),
      onEscLabel,
      getViewportRect: () => areaViewportRect(renderableTargetRef.current?.current ?? wrapperRef.current, scrollTargetRef.current?.current),
      getViewportClipRect: () => areaClipRect(renderableTargetRef.current?.current ?? wrapperRef.current, scrollTargetRef.current?.current),
      revealDescendant: (descendantPath, options) => {
        const reveal = revealDescendantRef.current ?? makeScrollReveal(scrollTargetRef.current)
        reveal?.(descendantPath, options)
      },
      captureFocusNavigationSnapshot: () =>
        (captureSnapshotRef.current ?? makeScrollSnapshotCapture(scrollTargetRef.current))?.(),
      restoreFocusNavigationSnapshot: (snapshot) =>
        (restoreSnapshotRef.current ?? makeScrollSnapshotRestore(scrollTargetRef.current))?.(snapshot),
    })
  }, [onEscLabel, path, trap, tree])

  return (
    <FocusParentPathProvider path={path}>
      <box {...boxProps} id={focusNavigableRenderableId(path)} ref={wrapperRef}>
        {children}
      </box>
    </FocusParentPathProvider>
  )
}

function areaViewportRect(
  renderable: Renderable | null | undefined,
  scrollbox: ScrollBoxRenderable | null | undefined,
) {
  return scrollViewportRect(scrollbox) ?? renderableViewportRect(renderable)
}

function areaClipRect(
  renderable: Renderable | null | undefined,
  scrollbox: ScrollBoxRenderable | null | undefined,
) {
  return scrollViewportRect(scrollbox) ?? renderableViewportRect(renderable)
}

function makeScrollReveal(scrollRef: RefObject<ScrollBoxRenderable | null> | undefined) {
  if (!scrollRef) {
    return undefined
  }

  return (descendantPath: FocusNavigablePath) => {
    scrollRef.current?.scrollChildIntoView(focusNavigableRenderableId(descendantPath))
  }
}

function makeScrollSnapshotCapture(scrollRef: RefObject<ScrollBoxRenderable | null> | undefined) {
  if (!scrollRef) {
    return undefined
  }

  return () => {
    const scrollbox = scrollRef.current
    return scrollbox
      ? ({
          left: scrollbox.scrollLeft,
          top: scrollbox.scrollTop,
        } satisfies ScrollSnapshot)
      : undefined
  }
}

function makeScrollSnapshotRestore(scrollRef: RefObject<ScrollBoxRenderable | null> | undefined) {
  if (!scrollRef) {
    return undefined
  }

  return (snapshot: unknown) => {
    const scrollbox = scrollRef.current
    if (!scrollbox || !isScrollSnapshot(snapshot)) {
      return
    }
    scrollbox.scrollTo({ x: snapshot.left, y: snapshot.top })
  }
}

function isScrollSnapshot(value: unknown): value is ScrollSnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    "left" in value &&
    typeof value.left === "number" &&
    "top" in value &&
    typeof value.top === "number"
  )
}
