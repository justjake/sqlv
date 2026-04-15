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
  type RefObject,
  type ReactNode,
} from "react"
import { focusPathKey, type FocusDirection, type FocusPath } from "../../lib/focus"
import { useFocusNavigationRestoreController, useFocusPath, useFocusTree } from "../focus"
import {
  normalizeShortcutKeyName,
  type ShortcutKeyUnion as BaseShortcutKeyUnion,
  type ShortcutKeys,
  type ShortcutModifiedKey,
  type ShortcutModifiers,
} from "./shortcutKeys"

// ---------------------------------------------------------------------------
// Chord step: one keypress within a shortcut/leader chord sequence
// ---------------------------------------------------------------------------

export type KeyStep = {
  name?: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
  option?: boolean
  super?: boolean
}

export type ShortcutSequenceInput = string | ShortcutKeys
export type ShortcutKeyUnion = BaseShortcutKeyUnion<ShortcutSequenceInput>
export type ShortcutKeyInput = ShortcutSequenceInput | ShortcutKeyUnion

/** `option` is accepted in shortcut syntax for display, but matching relies on `meta` because many terminals never set `event.option`. */
export function stepMatches(step: KeyStep, event: KeyEvent): boolean {
  if (matchesCollapsedCtrlSymbol(step, event)) return true
  if (step.name !== undefined && !keyNameMatches(step.name, event.name)) return false
  if (!!step.ctrl !== !!event.ctrl) return false
  if (!!step.shift !== !!event.shift) return false
  if (!!step.meta !== !!event.meta) return false
  if (!!step.super !== !!event.super) return false
  return true
}

const collapsedCtrlSymbolNames = {
  "\u0000": ["@", "space"],
  "\u001b": ["[", "esc"],
  "\u001c": [",", "\\"],
  "\u001d": ["]"],
  "\u001e": [".", "^"],
  "\u001f": ["/", "-", "_", "?"],
} as const satisfies Record<string, readonly string[]>

function matchesCollapsedCtrlSymbol(step: KeyStep, event: KeyEvent): boolean {
  const expectedName = step.name
  const eventName = event.name

  if (!step.ctrl || step.shift || step.meta || step.option || step.super || expectedName === undefined) {
    return false
  }
  if (event.ctrl || event.shift || event.meta || event.option || event.super) {
    return false
  }

  if (!eventName || !(eventName in collapsedCtrlSymbolNames)) {
    return false
  }

  const candidateNames = collapsedCtrlSymbolNames[eventName as keyof typeof collapsedCtrlSymbolNames]
  return candidateNames.some((candidate: string) => keyNameMatches(expectedName, candidate))
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
    if (!!sa.super !== !!sb.super) return false
  }
  return true
}

function eventToStep(e: KeyEvent): KeyStep {
  return { name: e.name, ctrl: e.ctrl, shift: e.shift, meta: e.meta, option: e.option, super: e.super }
}

function isShortcutKeyUnion(input: ShortcutKeyInput): input is ShortcutKeyUnion {
  return typeof input === "object" && input !== null && !Array.isArray(input) && "or" in input
}

function shortcutKeyAlternatives(input: ShortcutKeyInput): readonly ShortcutSequenceInput[] {
  return isShortcutKeyUnion(input) ? input.or : [input]
}

function shortcutSequenceSignature(input: ShortcutSequenceInput): string {
  if (typeof input === "string") {
    return `string:${input}`
  }

  return `chain:${input.join("\u0001")}`
}

function shortcutKeyInputSignature(input: ShortcutKeyInput | undefined): string | undefined {
  if (input === undefined) {
    return undefined
  }

  return shortcutKeyAlternatives(input).map((sequence) => shortcutSequenceSignature(sequence)).join("\u0000")
}

// ---------------------------------------------------------------------------
// Parse leader chords like "ctrl+w h" into chord steps
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
            step.meta = true
            step.option = true
            break
          case "command":
          case "super":
            step.super = true
            break
          default:
            step.name = token
            break
        }
      }
      return step
    })
}

function parseShortcutSequence(input: ShortcutSequenceInput): KeyStep[] {
  if (typeof input === "string") {
    return parseKeys(input)
  }

  return input.flatMap((item) => parseKeys(item))
}

export function parseKeyAlternatives(input: ShortcutKeyInput): KeyStep[][] {
  return shortcutKeyAlternatives(input).map((item) => parseShortcutSequence(item))
}

export function labelizeSequence(seq: KeyStep[]): string {
  return seq
    .map((step) => {
      let s = ""
      if (step.ctrl) s += "⌃"
      if (step.option) s += "⌥"
      else if (step.meta) s += "alt+"
      if (step.shift) s += "⇧"
      if (step.super) s += "⌘"
      if (step.name) s += labelizeKeyName(step.name)
      return s
    })
    .join(" ")
}

export function labelizeSequences(sequences: readonly KeyStep[][]): string {
  return sequences.map((sequence) => labelizeSequence(sequence)).join(" / ")
}

export function labelizeShortcutInput(input: ShortcutKeyInput, platform: string = process.platform): string {
  const sequences = parseKeyAlternatives(input)

  if (!isShortcutKeyUnion(input)) {
    return labelizeSequences(sequences)
  }

  return labelizeSequences(collapseCtrlSuperAlternativesForPlatform(sequences, platform))
}

type CtrlSuperVariant = "ctrl" | "super" | "other"

function collapseCtrlSuperAlternativesForPlatform(
  sequences: readonly KeyStep[][],
  platform: string,
): readonly KeyStep[][] {
  const preferredVariant: Exclude<CtrlSuperVariant, "other"> = platform === "darwin" ? "super" : "ctrl"
  const groupedVariants = new Map<string, Set<Exclude<CtrlSuperVariant, "other">>>()

  for (const sequence of sequences) {
    const variant = ctrlSuperVariant(sequence)
    const groupKey = ctrlSuperGroupKey(sequence)
    if (variant === "other" || groupKey === undefined) {
      continue
    }

    const variants = groupedVariants.get(groupKey) ?? new Set<Exclude<CtrlSuperVariant, "other">>()
    variants.add(variant)
    groupedVariants.set(groupKey, variants)
  }

  const emittedGroups = new Set<string>()

  return sequences.filter((sequence) => {
    const variant = ctrlSuperVariant(sequence)
    const groupKey = ctrlSuperGroupKey(sequence)
    if (variant === "other" || groupKey === undefined) {
      return true
    }

    const variants = groupedVariants.get(groupKey)
    if (!variants || variants.size < 2) {
      return true
    }

    if (variant !== preferredVariant) {
      return false
    }

    if (emittedGroups.has(groupKey)) {
      return false
    }

    emittedGroups.add(groupKey)
    return true
  })
}

function ctrlSuperVariant(sequence: readonly KeyStep[]): CtrlSuperVariant {
  let variant: Exclude<CtrlSuperVariant, "other"> | undefined

  for (const step of sequence) {
    const hasCtrl = !!step.ctrl
    const hasSuper = !!step.super

    if (hasCtrl && hasSuper) {
      return "other"
    }

    if (!hasCtrl && !hasSuper) {
      continue
    }

    const stepVariant: Exclude<CtrlSuperVariant, "other"> = hasCtrl ? "ctrl" : "super"
    if (variant && variant !== stepVariant) {
      return "other"
    }

    variant = stepVariant
  }

  return variant ?? "other"
}

function ctrlSuperGroupKey(sequence: readonly KeyStep[]): string | undefined {
  if (ctrlSuperVariant(sequence) === "other") {
    return undefined
  }

  return sequence
    .map((step) =>
      JSON.stringify({
        ctrlOrSuper: !!step.ctrl || !!step.super,
        meta: !!step.meta,
        name: normalizeShortcutKeyName(step.name),
        option: !!step.option,
        shift: !!step.shift,
      }),
    )
    .join("\u0001")
}

function labelizeKeyName(name: string): string {
  switch (name) {
    case "plus":
      return "+"
    case "return":
      return "⮐"
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

function isPlainNavigationLetterKey(event: KeyEvent): boolean {
  return !event.ctrl && !event.shift && !event.meta && !event.option && !event.super
}

function focusNavigationDirectionForKey(event: KeyEvent): FocusDirection | undefined {
  switch (normalizeShortcutKeyName(event.name)) {
    case "up":
      return "up"
    case "down":
      return "down"
    case "left":
      return "left"
    case "right":
      return "right"
    case "h":
      return isPlainNavigationLetterKey(event) ? "left" : undefined
    case "j":
      return isPlainNavigationLetterKey(event) ? "down" : undefined
    case "k":
      return isPlainNavigationLetterKey(event) ? "up" : undefined
    case "l":
      return isPlainNavigationLetterKey(event) ? "right" : undefined
    default:
      return undefined
  }
}

function isFocusNavigationActivationKey(event: KeyEvent): boolean {
  const name = normalizeShortcutKeyName(event.name)
  return name === "enter" || name === "return" || name === "space"
}

// ---------------------------------------------------------------------------
// Provider internals
// ---------------------------------------------------------------------------

type ShortcutEntry = {
  detectRef: React.RefObject<((key: KeyEvent) => boolean) | undefined>
  global?: boolean
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
    return () => {
      subs.current.delete(cb)
    }
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

        if (normalizeShortcutKeyName(key.name) === "esc") {
          setSkipFocusRestoreOnExit(false)
          tree.handleEscape()
          return
        }

        const direction = focusNavigationDirectionForKey(key)
        if (direction) {
          tree.moveFocusNavigation(direction)
          return
        }

        if (isFocusNavigationActivationKey(key)) {
          setSkipFocusRestoreOnExit(true)
          tree.activateHighlightedFocusable()
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
    const seen = new Set<ShortcutEntry>()

    for (const scopeKey of scopeKeys) {
      const match = findNewestMatchingEntry(scopeKey, matches)
      if (match && !seen.has(match)) {
        matched.push(match)
        seen.add(match)
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
      if (entry.scopeKey !== scopeKey && !(scopeKey === undefined && entry.global)) {
        continue
      }
      if (matches(entry)) {
        return entry
      }
    }

    return undefined
  }

  function hasChordPrefixForScopes(scopeKeys: Array<string | undefined>, candidate: KeyStep[]): boolean {
    for (const scopeKey of scopeKeys) {
      for (let index = shortcutRegistry.current.length - 1; index >= 0; index -= 1) {
        const entry = shortcutRegistry.current[index]!
        if (!entry.enabledRef.current) {
          continue
        }
        if (
          (entry.scopeKey !== scopeKey && !(scopeKey === undefined && entry.global)) ||
          entry.sequence.length <= candidate.length
        ) {
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

  function findNewestMatchingKeyHandler(scopeKey: string | undefined, key: KeyEvent): KeybindHandlerEntry | undefined {
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
  /** Key sequence, chord chain, or explicit alternatives, e.g. `"ctrl+w h"`, `["ctrl+w", "h"]`, or `{ or: ["up", "k"] }`. */
  keys: ShortcutKeyInput
  /** Additional predicate applied after sequence matching. */
  detect?: (key: KeyEvent) => boolean
  enabled?: boolean
  /** Allow the shortcut to also participate in global fallback routing. */
  global?: boolean
  onKey?: (key: KeyEvent) => void
}

export type UseKeybindHandlerOptions = Omit<UseShortcutOptions, "keys"> & {
  /** Optional key sequence. Omit to receive all scoped keypresses. */
  keys?: ShortcutKeyInput
}

export const NavKeyAlias = {
  activate: ["space", "return"],
  down: ["down", "j"],
  esc: ["esc"],
  left: ["left", "h"],
  right: ["right", "l"],
  up: ["up", "k"],
} as const

export type NavKeyName = keyof typeof NavKeyAlias
type NavKeyAliasByName = { [K in NavKeyName]: (typeof NavKeyAlias)[K][number] }
export type AliasedByNavKeyName = { [K in NavKeyName]: Exclude<NavKeyAliasByName[K], K> }[NavKeyName]
export type AliasedByNavKey = `${ShortcutModifiers}${AliasedByNavKeyName}`
export type NavKey = `${ShortcutModifiers}${NavKeyName}`
type NavKeyHandler = (key: KeyEvent) => void

const navKeyNames = Object.keys(NavKeyAlias) as NavKeyName[]
const navKeyModifierPrefixes = buildNavKeyModifierPrefixes()
const allNavKeys = navKeyModifierPrefixes.flatMap((prefix) => navKeyNames.map((name) => `${prefix}${name}` as NavKey))

export type UseNavKeysOptions = Partial<Record<NavKey, NavKeyHandler>> & {
  detect?: (key: KeyEvent) => boolean
  enabled?: boolean
  global?: boolean
  prevent?: AliasedByNavKey | readonly AliasedByNavKey[]
}

/**
 * Keyboard shortcut hook.
 *
 * Registered shortcuts are dispatched by the provider's central input
 * router. Routing is scoped to the nearest focus path and bubbles
 * outward through focused ancestors before falling back to global
 * shortcuts.
 *
 * Returns the parsed sequences for display purposes.
 */
export function useShortcut(options: UseShortcutOptions): { sequence: KeyStep[]; sequences: KeyStep[][] } {
  const keySignature = shortcutKeyInputSignature(options.keys)
  const sequences = useMemo(() => parseKeyAlternatives(options.keys), [keySignature])
  useKeybindHandler(options)

  return { sequence: sequences[0] ?? [], sequences }
}

export function translateNavKey(navKey: NavKey): ShortcutKeyInput {
  const { modifiers, name } = splitNavKey(navKey)
  const translatedKeys = NavKeyAlias[name].map((key) => `${modifiers}${key}` as ShortcutModifiedKey)
  return alternativesToShortcutKeyInput(translatedKeys)
}

export function useNavKeys(options: UseNavKeysOptions): void {
  const ctx = useKeybind()
  const scopePath = useFocusPath()
  const global = options.global === true
  const handlers = collectNavHandlers(options)
  const activeNavKeys = allNavKeys.filter((navKey) => handlers[navKey] !== undefined)
  const activeNavKeySignature = activeNavKeys.join("\u0000")
  const preventSignature = navPreventSignature(options.prevent)
  const preventSet = useMemo(() => navPreventSet(options.prevent), [preventSignature])
  const handlersRef = useRef(handlers)
  const detectRef = useRef(options.detect)
  const shortcutsEnabledRef = useRef(options.enabled !== false)

  handlersRef.current = handlers
  detectRef.current = options.detect
  shortcutsEnabledRef.current = options.enabled !== false

  const registrations = useMemo(
    () =>
      activeNavKeys.flatMap((navKey) => {
        const keys = resolveNavKeyInputs(navKey, preventSet)
        return parseKeyAlternatives(keys).map((sequence) => ({
          callbackRef: makeRefObject<((key: KeyEvent) => void) | undefined>((key) =>
            handlersRef.current[navKey]?.(key),
          ),
          detectRef: makeRefObject<((key: KeyEvent) => boolean) | undefined>((key) => {
            if (!shortcutsEnabledRef.current) {
              return false
            }

            if (handlersRef.current[navKey] === undefined) {
              return false
            }

            return detectRef.current ? detectRef.current(key) : true
          }),
          enabledRef: makeRefObject(true),
          sequence,
        }))
      }),
    [activeNavKeySignature, preventSet],
  )

  useLayoutEffect(() => {
    const unregisters = registrations.map((entry) =>
      ctx.registerShortcut({
        callbackRef: entry.callbackRef,
        detectRef: entry.detectRef,
        enabledRef: entry.enabledRef,
        global,
        scopePath,
        sequence: entry.sequence,
      }),
    )

    return () => {
      for (let index = unregisters.length - 1; index >= 0; index -= 1) {
        unregisters[index]!()
      }
    }
  }, [ctx, global, registrations, scopePath])
}

export function useKeybindHandler(options: UseKeybindHandlerOptions): void {
  const ctx = useKeybind()
  const scopePath = useFocusPath()
  const hasKeys = options.keys !== undefined
  const global = options.global === true
  const keySignature = shortcutKeyInputSignature(options.keys)
  const sequences = useMemo(() => (options.keys ? parseKeyAlternatives(options.keys) : undefined), [keySignature])

  const callbackRef = useRef(options.onKey)
  callbackRef.current = options.onKey
  const enabledRef = useRef(options.enabled !== false)
  enabledRef.current = options.enabled !== false
  const detectRef = useRef(options.detect)
  detectRef.current = options.detect

  useLayoutEffect(() => {
    if (hasKeys) {
      if (!sequences || sequences.length === 0) {
        return
      }

      const unregisters = sequences.map((sequence) =>
        ctx.registerShortcut({
          callbackRef,
          detectRef,
          enabledRef,
          global,
          scopePath,
          sequence,
        }),
      )

      return () => {
        for (let index = unregisters.length - 1; index >= 0; index -= 1) {
          unregisters[index]!()
        }
      }
    }

    return ctx.registerKeyHandler({
      callbackRef,
      detectRef,
      enabledRef,
      scopePath,
    })
  }, [ctx, global, hasKeys, scopePath, sequences])
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

function makeRefObject<T>(current: T): RefObject<T> {
  return { current } as RefObject<T>
}

function buildNavKeyModifierPrefixes(): readonly ShortcutModifiers[] {
  const ctrlPrefixes = ["", "ctrl+"] as const
  const optionPrefixes = ["", "option+"] as const
  const shiftPrefixes = ["", "shift+"] as const
  const commandPrefixes = ["", "command+", "super+"] as const
  const prefixes: ShortcutModifiers[] = []

  for (const ctrl of ctrlPrefixes) {
    for (const option of optionPrefixes) {
      for (const shift of shiftPrefixes) {
        for (const command of commandPrefixes) {
          prefixes.push(`${ctrl}${option}${shift}${command}` as ShortcutModifiers)
        }
      }
    }
  }

  return prefixes
}

function collectNavHandlers(options: UseNavKeysOptions): Partial<Record<NavKey, NavKeyHandler>> {
  const handlers: Partial<Record<NavKey, NavKeyHandler>> = {}

  for (const navKey of allNavKeys) {
    const handler = options[navKey]
    if (handler) {
      handlers[navKey] = handler
    }
  }

  return handlers
}

function navPreventSet(prevent: UseNavKeysOptions["prevent"]): ReadonlySet<string> {
  if (!prevent) {
    return new Set()
  }

  const values = Array.isArray(prevent) ? prevent : [prevent]
  return new Set(values)
}

function navPreventSignature(prevent: UseNavKeysOptions["prevent"]): string {
  if (!prevent) {
    return ""
  }

  const values = (Array.isArray(prevent) ? [...prevent] : [prevent]).sort()
  return values.join("\u0000")
}

function resolveNavKeyInputs(navKey: NavKey, prevent: ReadonlySet<string>): ShortcutKeyInput {
  const translated = shortcutKeyAlternatives(translateNavKey(navKey)).map((key) => key as ShortcutModifiedKey)
  if (prevent.size === 0) {
    return alternativesToShortcutKeyInput(translated)
  }

  return alternativesToShortcutKeyInput(translated.filter((key) => !prevent.has(key)))
}

function alternativesToShortcutKeyInput(keys: readonly ShortcutModifiedKey[]): ShortcutKeyInput {
  if (keys.length === 1) {
    return keys[0]!
  }

  return { or: keys }
}

function splitNavKey(navKey: NavKey): { modifiers: ShortcutModifiers; name: NavKeyName } {
  const lastPlus = navKey.lastIndexOf("+")
  const modifiers = (lastPlus === -1 ? "" : navKey.slice(0, lastPlus + 1)) as ShortcutModifiers
  const name = (lastPlus === -1 ? navKey : navKey.slice(lastPlus + 1)) as NavKeyName

  if (!Object.hasOwn(NavKeyAlias, name)) {
    throw new Error(`Unknown nav key: ${navKey}`)
  }

  return { modifiers, name }
}
