import type { BoxRenderable, MouseEvent, Renderable } from "@opentui/core"
import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react"
import { focusPath, type FocusNavigablePath, type FocusNodeRegistration } from "../../lib/focus"
import { FocusNavigablePathProvider, useFocusParentPath, useFocusTree } from "./context"
import { focusNavigableRenderableId, renderableViewportRect } from "./utils"

type BoxProps = {
  [key: string]: unknown
  onMouseDown?: (event: MouseEvent) => void
}

export type FocusNavigableProps = Omit<BoxProps, "children" | "id" | "onMouseDown" | "ref"> & {
  children: ReactNode
  focusNavigableId: string
  renderableRef?: RefObject<Renderable | null>
  focus?: () => void
  autoFocus?: boolean
  disabled?: boolean
  onMouseDown?: (event: MouseEvent) => void
  captureFocusNavigationSnapshot?: FocusNodeRegistration["captureFocusNavigationSnapshot"]
  restoreFocusNavigationSnapshot?: FocusNodeRegistration["restoreFocusNavigationSnapshot"]
}

export function FocusNavigable(props: FocusNavigableProps) {
  const {
    autoFocus,
    captureFocusNavigationSnapshot,
    children,
    disabled,
    focus,
    focusNavigableId,
    onMouseDown,
    renderableRef,
    restoreFocusNavigationSnapshot,
    ...boxProps
  } = props
  const tree = useFocusTree()
  const parentPath = useFocusParentPath()
  const wrapperRef = useRef<BoxRenderable>(null)
  const path = useMemo(() => focusPath(parentPath, focusNavigableId), [focusNavigableId, parentPath]) satisfies FocusNavigablePath
  const focusHandlerRef = useRef(focus)
  const renderableTargetRef = useRef(renderableRef)
  const captureSnapshotRef = useRef(captureFocusNavigationSnapshot)
  const restoreSnapshotRef = useRef(restoreFocusNavigationSnapshot)

  focusHandlerRef.current = focus
  renderableTargetRef.current = renderableRef
  captureSnapshotRef.current = captureFocusNavigationSnapshot
  restoreSnapshotRef.current = restoreFocusNavigationSnapshot

  useEffect(() => {
    tree.registerNode({
      id: focusNavigableId,
      parentPath,
      focus: () => {
        ;(focusHandlerRef.current ?? noop)()
      },
      getViewportRect: () => renderableViewportRect(renderableTargetRef.current?.current ?? wrapperRef.current),
      disabled,
      captureFocusNavigationSnapshot: () => captureSnapshotRef.current?.(),
      restoreFocusNavigationSnapshot: (snapshot) => restoreSnapshotRef.current?.(snapshot),
    })

    return () => {
      tree.unregisterNode(path)
    }
  }, [focusNavigableId, parentPath, path, tree])

  useEffect(() => {
    tree.updateNode(path, {
      disabled,
      focus: () => {
        ;(focusHandlerRef.current ?? noop)()
      },
      getViewportRect: () => renderableViewportRect(renderableTargetRef.current?.current ?? wrapperRef.current),
      captureFocusNavigationSnapshot: () => captureSnapshotRef.current?.(),
      restoreFocusNavigationSnapshot: (snapshot) => restoreSnapshotRef.current?.(snapshot),
    })
  }, [disabled, path, tree])

  useEffect(() => {
    if (!autoFocus) {
      return
    }
    queueMicrotask(() => {
      tree.focusPath(path)
    })
  }, [autoFocus, path, tree])

  return (
    <FocusNavigablePathProvider path={path}>
      <box
        {...boxProps}
        id={focusNavigableRenderableId(path)}
        onMouseDown={(event) => {
          tree.focusPath(path)
          onMouseDown?.(event)
        }}
        ref={wrapperRef}
      >
        {children}
      </box>
    </FocusNavigablePathProvider>
  )
}

function noop() {}
