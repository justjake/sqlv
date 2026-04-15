import type { BoxRenderable, MouseEvent, Renderable, ScrollBoxRenderable } from "@opentui/core"
import { useInsertionEffect, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from "react"
import { focusPath, type FocusApplyContext, type FocusPath, type FocusableRegistration } from "../../lib/focus"
import { FocusPathProvider, useFocusParentPath, useFocusTree } from "./context"
import { focusableRenderableId, renderableViewportRect, scrollViewportRect } from "./utils"

type BoxProps = {
  [key: string]: unknown
  onMouseDown?: (event: MouseEvent) => void
}

type ScrollSnapshot = {
  left: number
  top: number
}

export type FocusableProps = Omit<BoxProps, "children" | "id" | "onMouseDown" | "ref"> & {
  children: ReactNode
  focusableId: string
  focusable?: boolean
  navigable?: boolean
  childrenNavigable?: boolean
  delegatesFocus?: boolean
  disabled?: boolean
  trap?: boolean
  onTrapEsc?: () => void
  trapEscLabel?: string
  renderableRef?: RefObject<Renderable | null>
  scrollRef?: RefObject<ScrollBoxRenderable | null>
  focusSelf?: boolean
  applyFocus?: (context: FocusApplyContext) => void
  autoFocus?: boolean
  onMouseDown?: (event: MouseEvent) => void
  revealDescendant?: FocusableRegistration["revealDescendant"]
  captureSnapshot?: FocusableRegistration["captureSnapshot"]
  restoreSnapshot?: FocusableRegistration["restoreSnapshot"]
}

export function Focusable(props: FocusableProps) {
  const {
    autoFocus,
    applyFocus,
    captureSnapshot,
    children,
    childrenNavigable,
    delegatesFocus,
    disabled,
    focusSelf,
    focusable,
    focusableId,
    navigable,
    onMouseDown,
    onTrapEsc,
    renderableRef,
    restoreSnapshot,
    revealDescendant,
    scrollRef,
    trap,
    trapEscLabel,
    ...boxProps
  } = props
  const tree = useFocusTree()
  const parentPath = useFocusParentPath()
  const wrapperRef = useRef<BoxRenderable>(null)
  const path = useMemo(() => focusPath(parentPath, focusableId), [focusableId, parentPath]) satisfies FocusPath
  const applyFocusRef = useRef(applyFocus)
  const renderableTargetRef = useRef(renderableRef)
  const revealDescendantRef = useRef(revealDescendant)
  const captureSnapshotRef = useRef(captureSnapshot)
  const restoreSnapshotRef = useRef(restoreSnapshot)
  const scrollTargetRef = useRef(scrollRef)
  const onTrapEscRef = useRef(onTrapEsc)
  const focusSelfRef = useRef(focusSelf)

  applyFocusRef.current = applyFocus
  renderableTargetRef.current = renderableRef
  revealDescendantRef.current = revealDescendant
  captureSnapshotRef.current = captureSnapshot
  restoreSnapshotRef.current = restoreSnapshot
  scrollTargetRef.current = scrollRef
  onTrapEscRef.current = onTrapEsc
  focusSelfRef.current = focusSelf

  function buildRegistration(): FocusableRegistration {
    return {
      id: focusableId,
      parentPath,
      focusable,
      navigable,
      childrenNavigable,
      delegatesFocus,
      disabled,
      trap,
      onTrapEsc: () => onTrapEscRef.current?.(),
      trapEscLabel,
      applyFocus: (context) => {
        const handler = applyFocusRef.current
        if (handler) {
          handler(context)
          return
        }

        if (!focusSelfRef.current) {
          return
        }

        const renderable = renderableTargetRef.current?.current ?? wrapperRef.current
        if (renderable && !renderable.isDestroyed) {
          renderable.focus()
        }
      },
      getViewportRect: () => renderableViewportRect(renderableTargetRef.current?.current ?? wrapperRef.current),
      getViewportClipRect: () =>
        scrollViewportRect(scrollTargetRef.current?.current) ??
        renderableViewportRect(renderableTargetRef.current?.current ?? wrapperRef.current),
      revealDescendant: (descendantPath, options) => {
        const reveal = revealDescendantRef.current ?? makeScrollReveal(scrollTargetRef.current)
        reveal?.(descendantPath, options)
      },
      captureSnapshot: () =>
        (captureSnapshotRef.current ?? makeScrollSnapshotCapture(scrollTargetRef.current))?.(),
      restoreSnapshot: (snapshot) =>
        (restoreSnapshotRef.current ?? makeScrollSnapshotRestore(scrollTargetRef.current))?.(snapshot),
    }
  }

  useInsertionEffect(() => {
    tree.registerFocusable(buildRegistration())

    return () => {
      tree.unregisterFocusable(path)
    }
  }, [path, tree])

  useLayoutEffect(() => {
    tree.updateFocusable(path, buildRegistration())
  }, [
    childrenNavigable,
    delegatesFocus,
    disabled,
    focusable,
    navigable,
    path,
    trap,
    trapEscLabel,
    tree,
  ])

  useLayoutEffect(() => {
    if (!autoFocus) {
      return
    }

    tree.focusPath(path)
  }, [autoFocus, path, tree])

  return (
    <FocusPathProvider path={path}>
      <box
        {...(focusSelf ? { focusable: true } : undefined)}
        {...boxProps}
        id={focusableRenderableId(path)}
        onMouseDown={(event) => {
          tree.focusPath(path, "mouse")
          onMouseDown?.(event)
        }}
        ref={wrapperRef}
      >
        {children}
      </box>
    </FocusPathProvider>
  )
}

function makeScrollReveal(scrollRef: RefObject<ScrollBoxRenderable | null> | undefined) {
  if (!scrollRef) {
    return undefined
  }

  return (descendantPath: FocusPath) => {
    scrollRef.current?.scrollChildIntoView(focusableRenderableId(descendantPath))
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
