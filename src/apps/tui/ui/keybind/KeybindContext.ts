import type { KeyEvent } from "@opentui/core"
import { createContext } from "react"
import type { FocusPath } from "../../../framework/focus/types"

import type { KeyStep } from "./shortcutSyntax"

export type ShortcutRegistration = {
  enabled?: boolean
  global?: boolean
  onKey?: (key: KeyEvent) => void
  scopePath: FocusPath | undefined
  sequence: KeyStep[]
}

export type KeybindContextValue = {
  registerShortcut: (entry: ShortcutRegistration) => () => void
  inChordRef: { readonly current: boolean }
  inChord: boolean
}

export const KeybindContext = createContext<KeybindContextValue | null>(null)
