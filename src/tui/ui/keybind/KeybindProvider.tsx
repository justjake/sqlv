import type { KeyEvent, Renderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react"
import { focusPathKey, type FocusDirection, type FocusPath } from "../../../lib/focus"
import { useFocusNavigationRestoreController, useFocusTree } from "../../focus"
import { normalizeShortcutKeyName } from "../shortcutKeys"
import { KeybindContext, type ShortcutRegistration } from "./KeybindContext"
import { eventToStep, sequenceEquals, stepMatches, type KeyStep } from "./shortcutSyntax"

type ShortcutEntry = Omit<ShortcutRegistration, "scopePath"> & {
  scopeKey: string | undefined
}

export type KeybindProviderProps = {
  children: ReactNode
  chordTimeout?: number
}

export function KeybindProvider({ chordTimeout = 2000, children }: KeybindProviderProps) {
  const tree = useFocusTree()
  const setSkipFocusRestoreOnExit = useFocusNavigationRestoreController()
  const renderer = useRenderer()
  const shortcutRegistry = useRef<ShortcutEntry[]>([])
  const prefix = useRef<KeyStep[]>([])
  const savedFocus = useRef<Renderable | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inChordRef = useRef(false)
  const subscribers = useRef(new Set<() => void>())

  const subscribe = useCallback((callback: () => void) => {
    subscribers.current.add(callback)
    return () => {
      subscribers.current.delete(callback)
    }
  }, [])
  const getSnapshot = useCallback(() => inChordRef.current, [])
  const inChord = useSyncExternalStore(subscribe, getSnapshot)

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

  useEffect(() => {
    function notify() {
      for (const callback of subscribers.current) {
        callback()
      }
    }

    function resetTimer() {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }

    function resetChordWithOptions(options: { restoreFocus: boolean }) {
      resetTimer()
      prefix.current = []
      const previousFocus = savedFocus.current
      savedFocus.current = null
      if (options.restoreFocus && previousFocus && !previousFocus.isDestroyed && !renderer.currentFocusedRenderable) {
        previousFocus.focus()
      }
      inChordRef.current = false
      notify()
    }

    function resetChord() {
      resetChordWithOptions({ restoreFocus: true })
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
        const completeMatches = collectMatchingEntriesForScopes(shortcutRegistry.current, scopeKeys, (entry) => {
          if (entry.sequence.length < 2) {
            return false
          }
          if (!sequenceEquals(entry.sequence, candidate)) {
            return false
          }
          if (entry.detect && !entry.detect(key)) {
            return false
          }
          return true
        })

        if (completeMatches.length > 0) {
          for (const entry of completeMatches) {
            entry.onKey?.(key)
            if (key.propagationStopped) {
              break
            }
          }
          setImmediate(() => resetChord())
          return
        }

        if (hasChordPrefixForScopes(shortcutRegistry.current, scopeKeys, candidate)) {
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

      if (hasChordPrefixForScopes(shortcutRegistry.current, scopeKeys, [step])) {
        key.preventDefault()
        key.stopPropagation()
        enterChord(step)
        return
      }

      const singleStepMatches = collectMatchingEntriesForScopes(shortcutRegistry.current, scopeKeys, (entry) => {
        if (entry.sequence.length !== 1) {
          return false
        }
        if (!stepMatches(entry.sequence[0]!, key)) {
          return false
        }
        if (entry.detect && !entry.detect(key)) {
          return false
        }
        return true
      })

      for (const entry of singleStepMatches) {
        entry.onKey?.(key)
        if (key.propagationStopped) {
          return
        }
      }

      if (normalizeShortcutKeyName(key.name) === "esc" && !key.defaultPrevented) {
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
  }, [chordTimeout, renderer, setSkipFocusRestoreOnExit, tree])

  return <KeybindContext.Provider value={{ registerShortcut, inChordRef, inChord }}>{children}</KeybindContext.Provider>
}

function collectMatchingEntriesForScopes(
  registry: readonly ShortcutEntry[],
  scopeKeys: Array<string | undefined>,
  matches: (entry: ShortcutEntry) => boolean,
): ShortcutEntry[] {
  const matched: ShortcutEntry[] = []
  const seen = new Set<ShortcutEntry>()

  for (const scopeKey of scopeKeys) {
    const match = findNewestMatchingEntry(registry, scopeKey, matches)
    if (match && !seen.has(match)) {
      matched.push(match)
      seen.add(match)
    }
  }

  return matched
}

function findNewestMatchingEntry(
  registry: readonly ShortcutEntry[],
  scopeKey: string | undefined,
  matches: (entry: ShortcutEntry) => boolean,
): ShortcutEntry | undefined {
  for (let index = registry.length - 1; index >= 0; index -= 1) {
    const entry = registry[index]!
    if (!entry.enabled()) {
      continue
    }
    if (!entryMatchesScope(entry, scopeKey)) {
      continue
    }
    if (matches(entry)) {
      return entry
    }
  }

  return undefined
}

function hasChordPrefixForScopes(
  registry: readonly ShortcutEntry[],
  scopeKeys: Array<string | undefined>,
  candidate: KeyStep[],
): boolean {
  for (const scopeKey of scopeKeys) {
    for (let index = registry.length - 1; index >= 0; index -= 1) {
      const entry = registry[index]!
      if (!entry.enabled()) {
        continue
      }
      if (!entryMatchesScope(entry, scopeKey) || entry.sequence.length <= candidate.length) {
        continue
      }
      if (sequenceEquals(candidate, entry.sequence.slice(0, candidate.length))) {
        return true
      }
    }
  }

  return false
}

function entryMatchesScope(entry: ShortcutEntry, scopeKey: string | undefined): boolean {
  return entry.scopeKey === scopeKey || (scopeKey === undefined && entry.global === true)
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
  return name === "return" || name === "space"
}
