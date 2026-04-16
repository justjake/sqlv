import { LayoutEvents, type EasingFunctions, type Renderable, Timeline, engine } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  FocusTree,
} from "../../lib/focus/FocusTree"
import {
  ROOT_FOCUS_PATH,
  focusPathKey,
  focusPathSubpath,
  isAncestorFocusPath,
  sameFocusPath,
} from "../../lib/focus/paths"
import type { FocusPath, FocusPathSuffix, FocusNavigationState } from "../../lib/focus/types"
import { renderableViewportRect } from "./utils"

const FOCUS_HALO_ANIMATION_MS = 110
const FOCUS_HALO_ANIMATION_EASES = [
  "outCirc",
  "outQuad",
  "inOutCirc",
  "inOutQuad",
  "inOutSine",
  "outExpo",
  "linear",
] as const satisfies readonly EasingFunctions[]

type FocusHaloAnimationEase = (typeof FOCUS_HALO_ANIMATION_EASES)[number]

type FocusHaloOverlayTarget = {
  backgroundColor: string
  ownerPathKey: string
  renderable: Renderable
  zIndex: number
}

type FocusHaloOverlayPresentation = {
  backgroundColor: string
  height: number
  ownerPathKey: string
  width: number
  x: number
  y: number
  zIndex: number
}

const FocusTreeContext = createContext<FocusTree | undefined>(undefined)
const FocusPathContext = createContext<FocusPath>(ROOT_FOCUS_PATH)
const CurrentFocusablePathContext = createContext<FocusPath | undefined>(undefined)
const FocusHaloOverlayContext = createContext<ReturnType<typeof createFocusHaloOverlayStore> | undefined>(undefined)
const FocusHaloAnimationContext = createContext<ReturnType<typeof createFocusHaloAnimationStore> | undefined>(undefined)
const FocusNavigationRestoreContext = createContext<
  ((skipRestoreOnExit: boolean) => void) | undefined
>(undefined)

export function FocusProvider(props: { children: ReactNode }) {
  const tree = useMemo(() => new FocusTree(), [])
  const haloOverlayStore = useMemo(() => createFocusHaloOverlayStore(), [])
  const haloAnimationStore = useMemo(() => createFocusHaloAnimationStore(), [])
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
      <FocusHaloAnimationContext.Provider value={haloAnimationStore}>
        <FocusHaloOverlayContext.Provider value={haloOverlayStore}>
          <FocusNavigationRestoreContext.Provider value={setSkipRestoreOnExit}>{props.children}</FocusNavigationRestoreContext.Provider>
        </FocusHaloOverlayContext.Provider>
      </FocusHaloAnimationContext.Provider>
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

export function useFocusHaloOverlayController(): Pick<
  ReturnType<typeof createFocusHaloOverlayStore>,
  "clearTarget" | "setTarget"
> {
  const controller = useContext(FocusHaloOverlayContext)
  if (!controller) {
    throw new Error("FocusProvider not found")
  }
  return controller
}

export function useFocusHaloAnimationEase(): FocusHaloAnimationEase {
  const store = useContext(FocusHaloAnimationContext)
  if (!store) {
    throw new Error("FocusProvider not found")
  }

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

export function useFocusHaloAnimationController(): Pick<
  ReturnType<typeof createFocusHaloAnimationStore>,
  "cycleEasing"
> {
  const controller = useContext(FocusHaloAnimationContext)
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

export function FocusHaloOverlay() {
  const store = useContext(FocusHaloOverlayContext)
  if (!store) {
    throw new Error("FocusProvider not found")
  }

  const target = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const easing = useFocusHaloAnimationEase()
  const [presentation, setPresentation] = useState<FocusHaloOverlayPresentation | null>(null)
  const animationRef = useRef<Timeline | null>(null)
  const presentationRef = useRef<FocusHaloOverlayPresentation | null>(null)

  const setPresentationState = useCallback((next: FocusHaloOverlayPresentation | null) => {
    presentationRef.current = next
    setPresentation(next)
  }, [])

  const stopAnimation = useCallback(() => {
    const animation = animationRef.current
    if (!animation) {
      return
    }

    animation.pause()
    engine.unregister(animation)
    animationRef.current = null
  }, [])

  useEffect(() => stopAnimation, [stopAnimation])

  useLayoutEffect(() => {
    if (!target) {
      stopAnimation()
      setPresentationState(null)
      return
    }

    const nextPresentation = createFocusHaloOverlayPresentation(target)
    if (!nextPresentation) {
      stopAnimation()
      setPresentationState(null)
      return
    }

    const syncCurrentRect = () => {
      if (presentationRef.current?.ownerPathKey !== target.ownerPathKey) {
        return
      }

      const currentPresentation = createFocusHaloOverlayPresentation(target)
      if (!currentPresentation) {
        stopAnimation()
        setPresentationState(null)
        return
      }

      stopAnimation()
      setPresentationState(currentPresentation)
    }

    target.renderable.on(LayoutEvents.LAYOUT_CHANGED, syncCurrentRect)
    target.renderable.on(LayoutEvents.RESIZED, syncCurrentRect)

    const previousPresentation = presentationRef.current
    if (
      !previousPresentation ||
      previousPresentation.ownerPathKey === nextPresentation.ownerPathKey ||
      sameFocusHaloRect(previousPresentation, nextPresentation)
    ) {
      stopAnimation()
      setPresentationState(nextPresentation)
    } else {
      stopAnimation()

      const animatedRect = {
        height: previousPresentation.height,
        width: previousPresentation.width,
        x: previousPresentation.x,
        y: previousPresentation.y,
      }
      const timeline = new Timeline({ autoplay: false })
      const finishAnimation = () => {
        if (animationRef.current === timeline) {
          animationRef.current = null
        }
        setPresentationState(nextPresentation)
        timeline.pause()
        engine.unregister(timeline)
      }

      animationRef.current = timeline
      engine.register(timeline)
      setPresentationState(withFocusHaloRect(nextPresentation, animatedRect))
      timeline.add(animatedRect, {
        duration: FOCUS_HALO_ANIMATION_MS,
        ease: easing,
        height: nextPresentation.height,
        onComplete: finishAnimation,
        onUpdate: () => {
          setPresentationState(withFocusHaloRect(nextPresentation, animatedRect))
        },
        width: nextPresentation.width,
        x: nextPresentation.x,
        y: nextPresentation.y,
      })
      timeline.play()
    }

    return () => {
      target.renderable.off(LayoutEvents.LAYOUT_CHANGED, syncCurrentRect)
      target.renderable.off(LayoutEvents.RESIZED, syncCurrentRect)
    }
  }, [easing, setPresentationState, stopAnimation, target])

  if (!presentation) {
    return null
  }

  return (
    <box height="100%" left={0} position="absolute" top={0} width="100%" zIndex={presentation.zIndex}>
      <box
        backgroundColor={presentation.backgroundColor}
        height={presentation.height}
        left={presentation.x}
        position="absolute"
        top={presentation.y}
        width={presentation.width}
      />
    </box>
  )
}

function createFocusHaloOverlayStore() {
  let target: FocusHaloOverlayTarget | null = null
  const listeners = new Set<() => void>()

  function notify() {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    clearTarget(ownerPathKey: string) {
      if (!target || target.ownerPathKey !== ownerPathKey) {
        return
      }

      target = null
      notify()
    },
    getSnapshot() {
      return target
    },
    setTarget(nextTarget: FocusHaloOverlayTarget) {
      if (sameFocusHaloOverlayTarget(target, nextTarget)) {
        return
      }

      target = nextTarget
      notify()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function createFocusHaloAnimationStore() {
  let easing: FocusHaloAnimationEase = FOCUS_HALO_ANIMATION_EASES[0]
  const listeners = new Set<() => void>()

  function notify() {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    cycleEasing() {
      const currentIndex = FOCUS_HALO_ANIMATION_EASES.indexOf(easing)
      const nextIndex = (currentIndex + 1) % FOCUS_HALO_ANIMATION_EASES.length
      easing = FOCUS_HALO_ANIMATION_EASES[nextIndex]!
      notify()
    },
    getSnapshot() {
      return easing
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function createFocusHaloOverlayPresentation(
  target: FocusHaloOverlayTarget,
): FocusHaloOverlayPresentation | null {
  const rect = renderableViewportRect(target.renderable)
  if (!rect) {
    return null
  }

  return withFocusHaloRect(target, rect)
}

function sameFocusHaloOverlayTarget(
  a: FocusHaloOverlayTarget | null,
  b: FocusHaloOverlayTarget | null,
): boolean {
  return (
    a?.backgroundColor === b?.backgroundColor &&
    a?.ownerPathKey === b?.ownerPathKey &&
    a?.renderable === b?.renderable &&
    a?.zIndex === b?.zIndex
  )
}

function sameFocusHaloRect(a: FocusHaloOverlayPresentation, b: FocusHaloOverlayPresentation): boolean {
  return a.height === b.height && a.width === b.width && a.x === b.x && a.y === b.y
}

function withFocusHaloRect(
  target: Pick<FocusHaloOverlayTarget, "backgroundColor" | "ownerPathKey" | "zIndex">,
  rect: { height: number; width: number; x: number; y: number },
): FocusHaloOverlayPresentation {
  return {
    backgroundColor: target.backgroundColor,
    height: Math.max(1, Math.round(rect.height)),
    ownerPathKey: target.ownerPathKey,
    width: Math.max(1, Math.round(rect.width)),
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    zIndex: target.zIndex,
  }
}
