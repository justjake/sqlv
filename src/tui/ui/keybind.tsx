import type { KeyEvent, Renderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { focusPathKey, type FocusPath } from "../../lib/focus"
import { useFocusNavigationRestoreController, useFocusPath, useFocusTree } from "../focus"
import { normalizeShortcutKeyName, type ShortcutKeys } from "./shortcutKeys"

// ---------------------------------------------------------------------------
// Chord step: one keypress within a shortcut/leader chord sequence
// ---------------------------------------------------------------------------

export type KeyStep = {
  name?: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
  option?: boolean
}

/** Does a concrete key event match a chord step? Undefined fields are wildcards. */
export function stepMatches(step: KeyStep, event: KeyEvent): boolean {
  if (step.name !== undefined && !keyNameMatches(step.name, event.name)) return false
  if (!!step.ctrl !== !!event.ctrl) return false
  if (!!step.shift !== !!event.shift) return false
  if (!!step.meta !== !!event.meta) return false
  if (!!step.option !== !!event.option) return false
  return true
}

function keyNameMatches(expected: string, actual: string | undefined): boolean {
  return normalizeShortcutKeyName(expected) === normalizeShortcutKeyName(actual)
}

function sequenceEquals(a: KeyStep[], b: KeyStep[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const sa = a[i]!
    const sb = b[i]!
    if (sa.name !== undefined || sb.name !== undefined) {
      if (sa.name === undefined || sb.name === undefined) return false
      if (!keyNameMatches(sa.name, sb.name)) return false
    }
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
// Parse leader chords like "ctrl+w h" into chord steps
// ---------------------------------------------------------------------------

export function parseKeys<TKey extends string>(input: ShortcutKeys<TKey>): KeyStep[]
export function parseKeys(input: string): KeyStep[]
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
      if (step.name) s += labelizeKeyName(step.name)
      return s
    })
    .join(" ")
}

function labelizeKeyName(name: string): string {
  switch (name) {
    case "up":
      return "↑"
    case "down":
      return "↓"
    case "left":
      return "←"
    case "right":
      return "→"
    default:
      return name
  }
}

// ---------------------------------------------------------------------------
// Provider internals
// ---------------------------------------------------------------------------

type ShortcutEntry = {
  detectRef: React.RefObject<((key: KeyEvent) => boolean) | undefined>
  scopeKey: string | undefined
  sequence: KeyStep[]
  callbackRef: React.RefObject<((key: KeyEvent) => void) | undefined>
  enabledRef: React.RefObject<boolean>
}

type ShortcutRegistration = Omit<ShortcutEntry, "scopeKey"> & {
  scopePath: FocusPath | undefined
}

type KeybindHandlerEntry = {
  detectRef: React.RefObject<((key: KeyEvent) => boolean) | undefined>
  scopeKey: string | undefined
  callbackRef: React.RefObject<((key: KeyEvent) => void) | undefined>
  enabledRef: React.RefObject<boolean>
}

type KeybindHandlerRegistration = Omit<KeybindHandlerEntry, "scopeKey"> & {
  scopePath: FocusPath | undefined
}

type KeybindContextValue = {
  /** Register a scoped shortcut. Returns an unregister function. */
  registerShortcut: (entry: ShortcutRegistration) => () => void
  /** Register a scoped raw key handler. Returns an unregister function. */
  registerKeyHandler: (entry: KeybindHandlerRegistration) => () => void
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
 * Owns TUI keyboard dispatch.
 *
 * Shortcuts register declaratively with a scope path inferred from the
 * nearest focusable. The provider routes keypresses by focus ancestry,
 * and falls back to focus-navigation behavior for bare `Esc` and the
 * focus-navigation key set when navigation mode is active.
 *
 * Multi-step chords still blur the currently-focused renderable while
 * the chord is in progress so subsequent keys are not swallowed by a
 * textarea. Focus is restored when the chord completes, times out, or
 * no registered chord matches the next key.
 */
export function KeybindProvider({ chordTimeout = 2000, children }: KeybindProviderProps) {
  const tree = useFocusTree()
  const setSkipFocusRestoreOnExit = useFocusNavigationRestoreController()
  const renderer = useRenderer()
  const shortcutRegistry = useRef<ShortcutEntry[]>([])
  const keyHandlerRegistry = useRef<KeybindHandlerEntry[]>([])
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
    resetChordWithOptions({ restoreFocus: true })
  }

  function resetChordWithOptions(options: { restoreFocus: boolean }) {
    resetTimer()
    prefix.current = []
    const prev = savedFocus.current
    savedFocus.current = null
    if (options.restoreFocus && prev && !prev.isDestroyed && !renderer.currentFocusedRenderable) {
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

  const registerShortcut = useCallback((entry: ShortcutRegistration) => {
    const registeredEntry: ShortcutEntry = {
      ...entry,
      scopeKey: focusPathKey(entry.scopePath),
    }

    shortcutRegistry.current.push(registeredEntry)
    return () => {
      const index = shortcutRegistry.current.indexOf(registeredEntry)
      if (index >= 0) {
        shortcutRegistry.current.splice(index, 1)
      }
    }
  }, [])

  const registerKeyHandler = useCallback((entry: KeybindHandlerRegistration) => {
    const registeredEntry: KeybindHandlerEntry = {
      ...entry,
      scopeKey: focusPathKey(entry.scopePath),
    }

    keyHandlerRegistry.current.push(registeredEntry)
    return () => {
      const index = keyHandlerRegistry.current.indexOf(registeredEntry)
      if (index >= 0) {
        keyHandlerRegistry.current.splice(index, 1)
      }
    }
  }, [])

  useEffect(() => {
    const handleKeyPress = (key: KeyEvent) => {
      const state = tree.getNavigationState()

      if (state.active) {
        if (inChordRef.current) {
          resetChordWithOptions({ restoreFocus: false })
        }

        key.preventDefault()
        key.stopPropagation()

        switch (key.name) {
          case "escape":
            setSkipFocusRestoreOnExit(false)
            tree.handleEscape()
            break
          case "up":
          case "down":
          case "left":
          case "right":
            tree.moveFocusNavigation(key.name)
            break
          case "enter":
          case "return":
          case "space":
            setSkipFocusRestoreOnExit(true)
            tree.activateHighlightedFocusable()
            break
        }
        return
      }

      const scopeKeys = collectScopeKeys(state.focusedPath)
      const step = eventToStep(key)

      if (inChordRef.current) {
        const candidate = [...prefix.current, step]
        const completeMatches = collectMatchingEntriesForScopes(scopeKeys, (entry) => {
          if (entry.sequence.length < 2) {
            return false
          }
          if (!sequenceEquals(entry.sequence, candidate)) {
            return false
          }
          if (entry.detectRef.current && !entry.detectRef.current(key)) {
            return false
          }
          return true
        })

        if (completeMatches.length > 0) {
          for (const entry of completeMatches) {
            entry.callbackRef.current?.(key)
            if (key.propagationStopped) {
              break
            }
          }
          setImmediate(() => resetChord())
          return
        }

        if (hasChordPrefixForScopes(scopeKeys, candidate)) {
          key.preventDefault()
          key.stopPropagation()
          advanceChord(step)
        } else {
          key.preventDefault()
          key.stopPropagation()
          resetChord()
        }
        return
      }

      if (hasChordPrefixForScopes(scopeKeys, [step])) {
        key.preventDefault()
        key.stopPropagation()
        enterChord(step)
        return
      }

      const singleStepMatches = collectMatchingEntriesForScopes(scopeKeys, (entry) => {
        if (entry.sequence.length !== 1) {
          return false
        }
        if (!stepMatches(entry.sequence[0]!, key)) {
          return false
        }
        if (entry.detectRef.current && !entry.detectRef.current(key)) {
          return false
        }
        return true
      })

      for (const entry of singleStepMatches) {
        entry.callbackRef.current?.(key)
        if (key.propagationStopped) {
          return
        }
      }

      const rawKeyHandlerMatches = collectMatchingKeyHandlersForScopes(scopeKeys, key)
      for (const entry of rawKeyHandlerMatches) {
        entry.callbackRef.current?.(key)
        if (key.propagationStopped) {
          return
        }
      }

      if (key.name === "escape" && !key.defaultPrevented) {
        key.preventDefault()
        key.stopPropagation()
        setSkipFocusRestoreOnExit(false)
        tree.handleEscape()
      }
    }

    renderer.keyInput.prependListener("keypress", handleKeyPress)
    return () => {
      renderer.keyInput.off("keypress", handleKeyPress)
    }
  }, [renderer, setSkipFocusRestoreOnExit, tree])

  function collectMatchingEntriesForScopes(
    scopeKeys: Array<string | undefined>,
    matches: (entry: ShortcutEntry) => boolean,
  ): ShortcutEntry[] {
    const matched: ShortcutEntry[] = []

    for (const scopeKey of scopeKeys) {
      const match = findNewestMatchingEntry(scopeKey, matches)
      if (match) {
        matched.push(match)
      }
    }

    return matched
  }

  function findNewestMatchingEntry(
    scopeKey: string | undefined,
    matches: (entry: ShortcutEntry) => boolean,
  ): ShortcutEntry | undefined {
    for (let index = shortcutRegistry.current.length - 1; index >= 0; index -= 1) {
      const entry = shortcutRegistry.current[index]!
      if (!entry.enabledRef.current) {
        continue
      }
      if (entry.scopeKey !== scopeKey) {
        continue
      }
      if (matches(entry)) {
        return entry
      }
    }

    return undefined
  }

  function hasChordPrefixForScopes(
    scopeKeys: Array<string | undefined>,
    candidate: KeyStep[],
  ): boolean {
    for (const scopeKey of scopeKeys) {
      for (let index = shortcutRegistry.current.length - 1; index >= 0; index -= 1) {
        const entry = shortcutRegistry.current[index]!
        if (!entry.enabledRef.current) {
          continue
        }
        if (entry.scopeKey !== scopeKey || entry.sequence.length <= candidate.length) {
          continue
        }
        if (sequenceEquals(candidate, entry.sequence.slice(0, candidate.length))) {
          return true
        }
      }
    }

    return false
  }

  function collectMatchingKeyHandlersForScopes(
    scopeKeys: Array<string | undefined>,
    key: KeyEvent,
  ): KeybindHandlerEntry[] {
    const matched: KeybindHandlerEntry[] = []

    for (const scopeKey of scopeKeys) {
      const match = findNewestMatchingKeyHandler(scopeKey, key)
      if (match) {
        matched.push(match)
      }
    }

    return matched
  }

  function findNewestMatchingKeyHandler(
    scopeKey: string | undefined,
    key: KeyEvent,
  ): KeybindHandlerEntry | undefined {
    for (let index = keyHandlerRegistry.current.length - 1; index >= 0; index -= 1) {
      const entry = keyHandlerRegistry.current[index]!
      if (!entry.enabledRef.current) {
        continue
      }
      if (entry.scopeKey !== scopeKey) {
        continue
      }
      if (entry.detectRef.current && !entry.detectRef.current(key)) {
        continue
      }
      return entry
    }

    return undefined
  }

  return (
    <KeybindContext.Provider value={{ registerShortcut, registerKeyHandler, inChordRef, inChord }}>
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
  /** Additional predicate applied after sequence matching. */
  detect?: (key: KeyEvent) => boolean
  enabled?: boolean
  onKey?: (key: KeyEvent) => void
}

export type UseKeybindHandlerOptions = Omit<UseShortcutOptions, "keys"> & {
  /** Optional key sequence. Omit to receive all scoped keypresses. */
  keys?: string
}

/**
 * Keyboard shortcut hook.
 *
 * Registered shortcuts are dispatched by the provider's central input
 * router. Routing is scoped to the nearest focus path and bubbles
 * outward through focused ancestors before falling back to global
 * shortcuts.
 *
 * Returns the parsed sequence for display purposes.
 */
export function useShortcut<TKey extends string>(
  options: Omit<UseShortcutOptions, "keys"> & { keys: ShortcutKeys<TKey> },
): { sequence: KeyStep[] }
export function useShortcut(options: UseShortcutOptions): { sequence: KeyStep[] }
export function useShortcut(options: UseShortcutOptions): { sequence: KeyStep[] } {
  const sequence = useMemo(() => parseKeys(options.keys), [options.keys])
  useKeybindHandler(options)

  return { sequence }
}

export function useKeybindHandler<TKey extends string>(
  options: Omit<UseKeybindHandlerOptions, "keys"> & { keys: ShortcutKeys<TKey> },
): void
export function useKeybindHandler(options: UseKeybindHandlerOptions): void
export function useKeybindHandler(options: UseKeybindHandlerOptions): void {
  const ctx = useKeybind()
  const scopePath = useFocusPath()
  const sequence = useMemo(() => (options.keys ? parseKeys(options.keys) : undefined), [options.keys])

  const callbackRef = useRef(options.onKey)
  callbackRef.current = options.onKey
  const enabledRef = useRef(options.enabled !== false)
  enabledRef.current = options.enabled !== false
  const detectRef = useRef(options.detect)
  detectRef.current = options.detect

  useLayoutEffect(() => {
    if (sequence) {
      return ctx.registerShortcut({
        callbackRef,
        detectRef,
        enabledRef,
        scopePath,
        sequence,
      })
    }

    return ctx.registerKeyHandler({
      callbackRef,
      detectRef,
      enabledRef,
      scopePath,
    })
  }, [ctx, scopePath, sequence])
}

function collectScopeKeys(path: FocusPath | undefined): Array<string | undefined> {
  const scopeKeys: Array<string | undefined> = []

  if (path) {
    for (let length = path.length; length >= 1; length -= 1) {
      scopeKeys.push(focusPathKey(path.slice(0, length)))
    }
  }

  scopeKeys.push(undefined)
  return scopeKeys
}
