import { LayoutEvents, type Renderable, Timeline, engine } from "@opentui/core"
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

const FOCUS_HALO_ANIMATION_MS = 120
const FOCUS_HALO_GHOST_ALPHA_MULTIPLIER = 0.8
const FOCUS_HALO_EDGE_ALPHA_MULTIPLIER = 2.3
const FOCUS_HALO_EDGE_BRIGHTEN = 0.5
const FOCUS_HALO_EDGE_START = 0.08
const FOCUS_HALO_EDGE_END = 0.78

type FocusHaloOverlayLayer = {
  backgroundColor: string
  height: number
  width: number
  x: number
  y: number
}

type FocusHaloOverlayTarget = {
  backgroundColor: string
  ownerPathKey: string
  renderable: Renderable
  zIndex: number
}

type FocusHaloOverlayPresentation = {
  backgroundColor: string
  edgeLight: FocusHaloOverlayLayer | null
  ghost: FocusHaloOverlayLayer | null
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
const FocusNavigationRestoreContext = createContext<
  ((skipRestoreOnExit: boolean) => void) | undefined
>(undefined)

export function FocusProvider(props: { children: ReactNode }) {
  const tree = useMemo(() => new FocusTree(), [])
  const haloOverlayStore = useMemo(() => createFocusHaloOverlayStore(), [])
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
      <FocusHaloOverlayContext.Provider value={haloOverlayStore}>
        <FocusNavigationRestoreContext.Provider value={setSkipRestoreOnExit}>{props.children}</FocusNavigationRestoreContext.Provider>
      </FocusHaloOverlayContext.Provider>
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

      const animationStart = createTransitionFocusHaloPresentation(nextPresentation, previousPresentation, previousPresentation, 0)
      const animatedRect = {
        height: previousPresentation.height,
        width: previousPresentation.width,
        x: previousPresentation.x,
        y: previousPresentation.y,
      }
      const timeline = new Timeline({ autoplay: false })

      animationRef.current = timeline
      engine.register(timeline)
      setPresentationState(animationStart)
      timeline.add(animatedRect, {
        duration: FOCUS_HALO_ANIMATION_MS,
        ease: "inOutSine",
        height: nextPresentation.height,
        width: nextPresentation.width,
        x: nextPresentation.x,
        y: nextPresentation.y,
        onComplete: () => {
          if (animationRef.current === timeline) {
            animationRef.current = null
          }
          setPresentationState(nextPresentation)
          timeline.pause()
          engine.unregister(timeline)
        },
        onUpdate: (animation) => {
          const frame = animation.targets[0] as typeof animatedRect
          setPresentationState(
            createTransitionFocusHaloPresentation(nextPresentation, previousPresentation, frame, animation.progress),
          )
        },
      })
      timeline.play()
    }

    return () => {
      target.renderable.off(LayoutEvents.LAYOUT_CHANGED, syncCurrentRect)
      target.renderable.off(LayoutEvents.RESIZED, syncCurrentRect)
    }
  }, [setPresentationState, stopAnimation, target])

  if (!presentation) {
    return null
  }

  return (
    <box height="100%" left={0} position="absolute" top={0} width="100%" zIndex={presentation.zIndex}>
      {presentation.ghost && (
        <box
          backgroundColor={presentation.ghost.backgroundColor}
          height={presentation.ghost.height}
          left={presentation.ghost.x}
          position="absolute"
          top={presentation.ghost.y}
          width={presentation.ghost.width}
        />
      )}
      <box
        backgroundColor={presentation.backgroundColor}
        height={presentation.height}
        left={presentation.x}
        position="absolute"
        top={presentation.y}
        width={presentation.width}
      >
        {presentation.edgeLight && (
          <box
            backgroundColor={presentation.edgeLight.backgroundColor}
            height={presentation.edgeLight.height}
            left={presentation.edgeLight.x - presentation.x}
            position="absolute"
            top={presentation.edgeLight.y - presentation.y}
            width={presentation.edgeLight.width}
          />
        )}
      </box>
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

function createTransitionFocusHaloPresentation(
  nextPresentation: FocusHaloOverlayPresentation,
  previousPresentation: FocusHaloOverlayPresentation,
  rect: { height: number; width: number; x: number; y: number },
  progress: number,
): FocusHaloOverlayPresentation {
  const currentPresentation = withFocusHaloRect(nextPresentation, rect)

  return {
    ...currentPresentation,
    edgeLight: createFocusHaloEdgeLight(currentPresentation, previousPresentation, nextPresentation, progress),
    ghost: createFocusHaloGhost(previousPresentation, progress),
  }
}

function withFocusHaloRect(
  target: Pick<FocusHaloOverlayTarget, "backgroundColor" | "ownerPathKey" | "zIndex">,
  rect: { height: number; width: number; x: number; y: number },
): FocusHaloOverlayPresentation {
  return {
    backgroundColor: target.backgroundColor,
    edgeLight: null,
    ghost: null,
    height: Math.max(1, Math.round(rect.height)),
    ownerPathKey: target.ownerPathKey,
    width: Math.max(1, Math.round(rect.width)),
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    zIndex: target.zIndex,
  }
}

function createFocusHaloGhost(
  previousPresentation: FocusHaloOverlayPresentation,
  progress: number,
): FocusHaloOverlayLayer | null {
  const alphaMultiplier = FOCUS_HALO_GHOST_ALPHA_MULTIPLIER * (1 - clamp(progress, 0, 1))
  if (alphaMultiplier <= 0.04) {
    return null
  }

  return {
    ...focusHaloRect(previousPresentation),
    backgroundColor: scaleHexAlpha(previousPresentation.backgroundColor, alphaMultiplier),
  }
}

function createFocusHaloEdgeLight(
  currentPresentation: FocusHaloOverlayPresentation,
  previousPresentation: FocusHaloOverlayPresentation,
  nextPresentation: FocusHaloOverlayPresentation,
  progress: number,
): FocusHaloOverlayLayer | null {
  const dx = nextPresentation.x - previousPresentation.x
  const dy = nextPresentation.y - previousPresentation.y
  if (dx === 0 && dy === 0) {
    return null
  }

  const phase = clamp(
    (progress - FOCUS_HALO_EDGE_START) / (FOCUS_HALO_EDGE_END - FOCUS_HALO_EDGE_START),
    0,
    1,
  )
  const intensity = Math.sin(Math.PI * phase)
  if (intensity <= 0.05) {
    return null
  }

  const backgroundColor = scaleHexAlpha(
    brightenHexColor(currentPresentation.backgroundColor, FOCUS_HALO_EDGE_BRIGHTEN),
    FOCUS_HALO_EDGE_ALPHA_MULTIPLIER * intensity,
  )

  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      backgroundColor,
      height: currentPresentation.height,
      width: 1,
      x: dx >= 0 ? currentPresentation.x + currentPresentation.width - 1 : currentPresentation.x,
      y: currentPresentation.y,
    }
  }

  return {
    backgroundColor,
    height: 1,
    width: currentPresentation.width,
    x: currentPresentation.x,
    y: dy >= 0 ? currentPresentation.y + currentPresentation.height - 1 : currentPresentation.y,
  }
}

function focusHaloRect(rect: Pick<FocusHaloOverlayPresentation, "height" | "width" | "x" | "y">) {
  return {
    height: rect.height,
    width: rect.width,
    x: rect.x,
    y: rect.y,
  }
}

function brightenHexColor(color: string, amount: number): string {
  if (!/^#[\da-fA-F]{6}([\da-fA-F]{2})?$/.test(color)) {
    return color
  }

  const alphaSuffix = color.length > 7 ? color.slice(7, 9) : ""
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  const bump = (channel: number) => Math.min(255, Math.round(channel + (255 - channel) * amount))
  return `#${bump(r).toString(16).padStart(2, "0")}${bump(g).toString(16).padStart(2, "0")}${bump(b).toString(16).padStart(2, "0")}${alphaSuffix}`
}

function scaleHexAlpha(color: string, multiplier: number): string {
  const alpha = readHexAlpha(color)
  if (alpha === undefined) {
    return color
  }

  return withHexAlpha(color, alpha * multiplier)
}

function readHexAlpha(color: string): number | undefined {
  if (!/^#[\da-fA-F]{6}([\da-fA-F]{2})?$/.test(color)) {
    return undefined
  }

  return color.length > 7 ? parseInt(color.slice(7, 9), 16) : 0xff
}

function withHexAlpha(color: string, alpha: number): string {
  if (!/^#[\da-fA-F]{6}([\da-fA-F]{2})?$/.test(color)) {
    return color
  }

  return `${color.slice(0, 7)}${clamp(Math.round(alpha), 0, 0xff).toString(16).padStart(2, "0")}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
