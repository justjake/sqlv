import type { KeyEvent, Renderable } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react"

// ---------------------------------------------------------------------------
// Key step: one keypress in a sequence
// ---------------------------------------------------------------------------

export type KeyStep = {
  name?: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
  option?: boolean
}

/** Does a concrete key event match a step? Undefined fields are wildcards. */
export function stepMatches(step: KeyStep, event: KeyEvent): boolean {
  if (step.name !== undefined && step.name !== event.name) return false
  if (!!step.ctrl !== !!event.ctrl) return false
  if (!!step.shift !== !!event.shift) return false
  if (!!step.meta !== !!event.meta) return false
  if (!!step.option !== !!event.option) return false
  return true
}

function sequenceEquals(a: KeyStep[], b: KeyStep[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const sa = a[i]!
    const sb = b[i]!
    if (sa.name !== sb.name) return false
    if (!!sa.ctrl !== !!sb.ctrl) return false
    if (!!sa.shift !== !!sb.shift) return false
    if (!!sa.meta !== !!sb.meta) return false
    if (!!sa.option !== !!sb.option) return false
  }
  return true
}

function eventToStep(e: KeyEvent): KeyStep {
  return { name: e.name, ctrl: e.ctrl, shift: e.shift, meta: e.meta, option: e.option }
}

// ---------------------------------------------------------------------------
// Parse "ctrl+w h" → KeyStep[]
// ---------------------------------------------------------------------------

export function parseKeys(input: string): KeyStep[] {
  return input
    .trim()
    .split(/\s+/)
    .map((part) => {
      const tokens = part.toLowerCase().split("+")
      const step: KeyStep = {}
      for (const token of tokens) {
        switch (token) {
          case "ctrl":
            step.ctrl = true
            break
          case "shift":
            step.shift = true
            break
          case "meta":
          case "alt":
            step.meta = true
            break
          case "option":
            step.option = true
            break
          default:
            step.name = token
            break
        }
      }
      return step
    })
}

export function labelizeSequence(seq: KeyStep[]): string {
  return seq
    .map((step) => {
      let s = ""
      if (step.ctrl) s += "^"
      if (step.shift) s += "⬆"
      if (step.meta) s += "alt+"
      if (step.option) s += "⌥"
      if (step.name) s += step.name
      return s
    })
    .join(" ")
}

// ---------------------------------------------------------------------------
// Provider internals
// ---------------------------------------------------------------------------

type ChordEntry = {
  sequence: KeyStep[]
  callbackRef: React.RefObject<((key: KeyEvent) => void) | undefined>
  enabledRef: React.RefObject<boolean>
}

type KeybindContextValue = {
  /** Register a multi-step chord. Returns an unregister function. */
  registerChord: (entry: ChordEntry) => () => void
  /** Synchronous ref — true while waiting for the next chord key. */
  inChordRef: { readonly current: boolean }
  /** Reactive flag for renders. */
  inChord: boolean
}

const KeybindContext = createContext<KeybindContextValue | null>(null)

export function useKeybind(): KeybindContextValue {
  const ctx = useContext(KeybindContext)
  if (!ctx) throw new Error("useKeybind requires a <KeybindProvider>")
  return ctx
}

// ---------------------------------------------------------------------------
// KeybindProvider
// ---------------------------------------------------------------------------

type KeybindProviderProps = {
  /** Timeout (ms) before an in-progress chord cancels. Default: 2000 */
  chordTimeout?: number
  children: ReactNode
}

/**
 * Manages multi-step keyboard chords.
 *
 * When a keypress matches the first step of a registered chord the
 * currently-focused renderable is blurred so subsequent keys aren't
 * swallowed by a textarea. Focus is restored when the chord completes,
 * times out, or no registered chord matches the next key.
 */
export function KeybindProvider({ chordTimeout = 2000, children }: KeybindProviderProps) {
  const renderer = useRenderer()
  const registry = useRef(new Map<symbol, ChordEntry>())
  const prefix = useRef<KeyStep[]>([])
  const savedFocus = useRef<Renderable | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inChordRef = useRef(false)

  // Reactive wrapper for inChord
  const subs = useRef(new Set<() => void>())
  const subscribe = useCallback((cb: () => void) => {
    subs.current.add(cb)
    return () => { subs.current.delete(cb) }
  }, [])
  const getSnapshot = useCallback(() => inChordRef.current, [])
  const inChord = useSyncExternalStore(subscribe, getSnapshot)

  function notify() {
    for (const cb of subs.current) cb()
  }

  function enterChord(firstStep: KeyStep) {
    prefix.current = [firstStep]
    inChordRef.current = true
    notify()
    savedFocus.current = renderer.currentFocusedRenderable
    savedFocus.current?.blur()
    resetTimer()
    timer.current = setTimeout(resetChord, chordTimeout)
  }

  function advanceChord(step: KeyStep) {
    prefix.current = [...prefix.current, step]
    resetTimer()
    timer.current = setTimeout(resetChord, chordTimeout)
  }

  function resetChord() {
    resetTimer()
    prefix.current = []
    const prev = savedFocus.current
    savedFocus.current = null
    if (prev && !prev.isDestroyed && !renderer.currentFocusedRenderable) {
      prev.focus()
    }
    inChordRef.current = false
    notify()
  }

  function resetTimer() {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  const registerChord = useCallback((entry: ChordEntry) => {
    const id = Symbol()
    registry.current.set(id, entry)
    return () => { registry.current.delete(id) }
  }, [])

  // Provider's keyboard handler — registered first (highest in tree).
  useKeyboard((key) => {
    const step = eventToStep(key)

    if (inChordRef.current) {
      // Mid-chord: try to advance
      const candidate = [...prefix.current, step]

      // Check for a complete match
      for (const entry of registry.current.values()) {
        if (!entry.enabledRef.current) continue
        if (sequenceEquals(entry.sequence, candidate)) {
          entry.callbackRef.current?.(key)
          setImmediate(() => resetChord())
          return
        }
      }

      // Check for a partial match (candidate is a prefix of some sequence)
      let hasPartial = false
      for (const entry of registry.current.values()) {
        if (!entry.enabledRef.current) continue
        const seq = entry.sequence
        if (candidate.length < seq.length && sequenceEquals(candidate, seq.slice(0, candidate.length))) {
          hasPartial = true
          break
        }
      }

      if (hasPartial) {
        advanceChord(step)
      } else {
        resetChord()
      }
      return
    }

    // Not in chord: does this key start any registered chord?
    for (const entry of registry.current.values()) {
      if (!entry.enabledRef.current) continue
      if (entry.sequence.length >= 2 && stepMatches(entry.sequence[0]!, key)) {
        enterChord(step)
        return
      }
    }
    // Single-step shortcuts are handled by their own useKeyboard hooks.
  })

  return (
    <KeybindContext.Provider value={{ registerChord, inChordRef, inChord }}>
      {children}
    </KeybindContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// useShortcut
// ---------------------------------------------------------------------------

export type UseShortcutOptions = {
  /** Key sequence as a string, e.g. "ctrl+w h" or "ctrl+x". */
  keys: string
  /** Additional predicate applied after sequence matching (single-step only). */
  detect?: (key: KeyEvent) => boolean
  enabled?: boolean
  onKey?: (key: KeyEvent) => void
}

/**
 * Keyboard shortcut hook.
 *
 * - Single-step (`keys="ctrl+x"` or field props): fires via a local
 *   `useKeyboard` handler, automatically suppressed during chords.
 * - Multi-step (`keys="ctrl+w h"`): registered with the provider's
 *   chord engine. The provider blurs focus while waiting for the
 *   next key and restores it on completion or timeout.
 *
 * Returns the parsed sequence for display purposes.
 */
export function useShortcut(options: UseShortcutOptions): { sequence: KeyStep[] } {
  const ctx = useKeybind()
  const sequence = useMemo(() => parseKeys(options.keys), [options.keys])
  const isChord = sequence.length >= 2

  const callbackRef = useRef(options.onKey)
  callbackRef.current = options.onKey
  const enabledRef = useRef(options.enabled !== false)
  enabledRef.current = options.enabled !== false
  const detectRef = useRef(options.detect)
  detectRef.current = options.detect

  // Multi-step: register chord with provider
  useEffect(() => {
    if (!isChord) return
    return ctx.registerChord({ sequence, callbackRef, enabledRef })
  }, [ctx, sequence, isChord])

  // Single-step: match locally, suppressed during chords
  useKeyboard((key) => {
    if (isChord) return
    if (!enabledRef.current) return
    if (ctx.inChordRef.current) return
    if (!stepMatches(sequence[0]!, key)) return
    if (detectRef.current && !detectRef.current(key)) return
    callbackRef.current?.(key)
  })

  return { sequence }
}
