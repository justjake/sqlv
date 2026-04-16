import type { KeyEvent } from "@opentui/core"
import type { ShortcutKeyInput } from "./shortcutSyntax"
import { useRegisterShortcuts } from "./useRegisterShortcuts"

export type UseShortcutOptions = {
  enabled?: boolean
  global?: boolean
  keys: ShortcutKeyInput
  onKey?: (key: KeyEvent) => void
}

export function useShortcut(options: UseShortcutOptions): void {
  useRegisterShortcuts([options])
}
