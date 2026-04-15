import type { Renderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  FocusTree,
  ROOT_FOCUS_PATH,
  focusPathKey,
  focusPathSubpath,
  isAncestorFocusPath,
  sameFocusPath,
  type FocusPath,
  type FocusPathSuffix,
  type FocusNavigationState,
} from "../../lib/focus"

const FocusTreeContext = createContext<FocusTree | undefined>(undefined)
const FocusPathContext = createContext<FocusPath>(ROOT_FOCUS_PATH)
const CurrentFocusablePathContext = createContext<FocusPath | undefined>(undefined)
const FocusNavigationRestoreContext = createContext<
  ((skipRestoreOnExit: boolean) => void) | undefined
>(undefined)

export function FocusProvider(props: { children: ReactNode }) {
  const tree = useMemo(() => new FocusTree(), [])
  const renderer = useRenderer()
  const wasNavigationActiveRef = useRef(false)
  const savedRenderableRef = useRef<Renderable | null>(null)
  const skipRestoreOnExitRef = useRef(false)
  const restoreSequenceRef = useRef(0)
  const setSkipRestoreOnExit = useCallback((skipRestoreOnExit: boolean) => {
    skipRestoreOnExitRef.current = skipRestoreOnExit
  }, [])

  useEffect(() => {
    return tree.subscribe(() => {
      const state = tree.getNavigationState()
      if (state.active && !wasNavigationActiveRef.current) {
        restoreSequenceRef.current += 1
        const renderable = renderer.currentFocusedRenderable
        savedRenderableRef.current = renderable && !renderable.isDestroyed ? renderable : null
        renderable?.blur()
      }

      if (!state.active && wasNavigationActiveRef.current) {
        const savedRenderable = savedRenderableRef.current
        const shouldRestore = !skipRestoreOnExitRef.current
        const restoreSequence = ++restoreSequenceRef.current
        savedRenderableRef.current = null
        skipRestoreOnExitRef.current = false

        if (shouldRestore && savedRenderable && !savedRenderable.isDestroyed) {
          queueMicrotask(() => {
            if (restoreSequenceRef.current !== restoreSequence) {
              return
            }
            if (!renderer.currentFocusedRenderable && !savedRenderable.isDestroyed) {
              savedRenderable.focus()
            }
          })
        }
      }

      wasNavigationActiveRef.current = state.active
    })
  }, [renderer, tree])

  useLayoutEffect(() => {
    tree.flushPendingChanges()
  })

  return (
    <FocusTreeContext.Provider value={tree}>
      <FocusNavigationRestoreContext.Provider value={setSkipRestoreOnExit}>
        {props.children}
      </FocusNavigationRestoreContext.Provider>
    </FocusTreeContext.Provider>
  )
}

export function useFocusTree(): FocusTree {
  const tree = useContext(FocusTreeContext)
  if (!tree) {
    throw new Error("FocusProvider not found")
  }
  return tree
}

export function useFocusNavigationRestoreController(): (skipRestoreOnExit: boolean) => void {
  const controller = useContext(FocusNavigationRestoreContext)
  if (!controller) {
    throw new Error("FocusProvider not found")
  }
  return controller
}

export function useFocusParentPath(): FocusPath {
  return useContext(FocusPathContext)
}

export function FocusPathProvider(props: { children: ReactNode; path: FocusPath }) {
  return (
    <CurrentFocusablePathContext.Provider value={props.path}>
      <FocusPathContext.Provider value={props.path}>{props.children}</FocusPathContext.Provider>
    </CurrentFocusablePathContext.Provider>
  )
}

export function useFocusPath(): FocusPath | undefined {
  return useContext(CurrentFocusablePathContext)
}

export function useFocusNavigationState(): FocusNavigationState {
  const tree = useFocusTree()
  return useSyncExternalStore(
    (listener) => tree.subscribe(listener),
    () => tree.getNavigationState(),
    () => tree.getNavigationState(),
  )
}

export function useIsFocusNavigationActive(): boolean {
  return useFocusNavigationState().active
}

export function useIsFocused(): boolean {
  const path = useFocusPath()
  const state = useFocusNavigationState()
  return sameFocusPath(path, state.focusedPath)
}

export function useIsHighlighted(): boolean {
  const path = useFocusPath()
  const state = useFocusNavigationState()
  return state.active && sameFocusPath(path, state.highlightedPath)
}

export function useIsFocusWithin(path: FocusPath): boolean {
  const state = useFocusNavigationState()
  return isAncestorFocusPath(path, state.focusedPath)
}

export function useFocusedDescendantPath(): FocusPath | undefined {
  const tree = useFocusTree()
  const path = useFocusPath()
  return useSyncExternalStore(
    (listener) => tree.subscribe(listener),
    () => (path ? tree.getFocusedDescendantPath(path) : undefined),
    () => (path ? tree.getFocusedDescendantPath(path) : undefined),
  )
}

export function useFocusedDescendantSubpath(): FocusPathSuffix | undefined {
  const path = useFocusPath()
  const descendantPath = useFocusedDescendantPath()
  return useMemo(
    () => (path ? focusPathSubpath(path, descendantPath) : undefined),
    [descendantPath, path],
  )
}

export function useHighlightedDescendantPath(): FocusPath | undefined {
  const tree = useFocusTree()
  const path = useFocusPath()
  return useSyncExternalStore(
    (listener) => tree.subscribe(listener),
    () => (path ? tree.getHighlightedDescendantPath(path) : undefined),
    () => (path ? tree.getHighlightedDescendantPath(path) : undefined),
  )
}

export function useHighlightedDescendantSubpath(): FocusPathSuffix | undefined {
  const path = useFocusPath()
  const descendantPath = useHighlightedDescendantPath()
  return useMemo(
    () => (path ? focusPathSubpath(path, descendantPath) : undefined),
    [descendantPath, path],
  )
}

export function useRememberedDescendantPath(): FocusPath | undefined {
  const tree = useFocusTree()
  const path = useFocusPath()
  return useSyncExternalStore(
    (listener) => tree.subscribe(listener),
    () => (path ? tree.getRememberedDescendantPath(path) : undefined),
    () => (path ? tree.getRememberedDescendantPath(path) : undefined),
  )
}

export function useRememberedDescendantSubpath(): FocusPathSuffix | undefined {
  const path = useFocusPath()
  const descendantPath = useRememberedDescendantPath()
  return useMemo(
    () => (path ? focusPathSubpath(path, descendantPath) : undefined),
    [descendantPath, path],
  )
}

export function useIsFocusNavigableFocused(): boolean {
  return useIsFocused()
}

export function useIsFocusNavigableHighlighted(): boolean {
  return useIsHighlighted()
}

export function useFocusNavigablePath(): FocusPath | undefined {
  return useFocusPath()
}

export function focusPathSignature(path: FocusPath | undefined): string | undefined {
  return focusPathKey(path)
}
