import type { KeyEvent, Renderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { FocusTree, ROOT_FOCUS_PATH, focusPathKey, isAncestorFocusPath, sameFocusPath, type FocusNavigablePath } from "../../lib/focus"

const FocusTreeContext = createContext<FocusTree | undefined>(undefined)
const FocusPathContext = createContext<FocusNavigablePath>(ROOT_FOCUS_PATH)
const CurrentFocusNavigablePathContext = createContext<FocusNavigablePath | undefined>(undefined)

export function FocusProvider(props: { children: ReactNode }) {
  const tree = useMemo(() => new FocusTree(), [])
  const renderer = useRenderer()
  const wasNavigationActiveRef = useRef(false)
  const savedRenderableRef = useRef<Renderable | null>(null)
  const skipRestoreOnExitRef = useRef(false)
  const restoreSequenceRef = useRef(0)

  useEffect(() => {
    const handleKeyPress = (event: KeyEvent) => {
      const state = tree.getNavigationState()
      if (state.active) {
        event.preventDefault()
        event.stopPropagation()

        switch (event.name) {
          case "escape":
            skipRestoreOnExitRef.current = false
            tree.handleEscape()
            break
          case "up":
          case "down":
          case "left":
          case "right":
            tree.moveFocusNavigation(event.name)
            break
          case "enter":
          case "space":
            skipRestoreOnExitRef.current = true
            tree.activateHighlightedFocusNavigable()
            break
        }
        return
      }

      if (event.name === "escape") {
        event.preventDefault()
        event.stopPropagation()
        skipRestoreOnExitRef.current = false
        tree.startFocusNavigation()
      }
    }

    renderer.keyInput.prependListener("keypress", handleKeyPress)
    return () => {
      renderer.keyInput.off("keypress", handleKeyPress)
    }
  }, [renderer, tree])

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

  return <FocusTreeContext.Provider value={tree}>{props.children}</FocusTreeContext.Provider>
}

export function useFocusTree(): FocusTree {
  const tree = useContext(FocusTreeContext)
  if (!tree) {
    throw new Error("FocusProvider not found")
  }
  return tree
}

export function useFocusParentPath(): FocusNavigablePath {
  return useContext(FocusPathContext)
}

export function FocusParentPathProvider(props: { children: ReactNode; path: FocusNavigablePath }) {
  return <FocusPathContext.Provider value={props.path}>{props.children}</FocusPathContext.Provider>
}

export function FocusNavigablePathProvider(props: { children: ReactNode; path: FocusNavigablePath }) {
  return (
    <CurrentFocusNavigablePathContext.Provider value={props.path}>
      <FocusPathContext.Provider value={props.path}>{props.children}</FocusPathContext.Provider>
    </CurrentFocusNavigablePathContext.Provider>
  )
}

export function useFocusNavigablePath(): FocusNavigablePath | undefined {
  return useContext(CurrentFocusNavigablePathContext)
}

export function useFocusNavigationState() {
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

export function useIsFocusNavigableHighlighted(): boolean {
  const path = useFocusNavigablePath()
  const state = useFocusNavigationState()
  return state.active && sameFocusPath(path, state.highlightedPath)
}

export function useIsFocusNavigableFocused(): boolean {
  const path = useFocusNavigablePath()
  const state = useFocusNavigationState()
  return sameFocusPath(path, state.focusedPath)
}

export function useIsFocusWithin(path: FocusNavigablePath): boolean {
  const state = useFocusNavigationState()
  return isAncestorFocusPath(path, state.focusedPath)
}

export function focusPathSignature(path: FocusNavigablePath | undefined): string | undefined {
  return focusPathKey(path)
}
