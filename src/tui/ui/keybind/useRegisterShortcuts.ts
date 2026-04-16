import type { KeyEvent } from "@opentui/core"
import { useLayoutEffect } from "react"
import { useFocusPath } from "../../focus/context"
import { parseKeyAlternatives, type ShortcutKeyInput } from "./shortcutSyntax"
import { useKeybind } from "./useKeybind"

export type ShortcutBindingSpec = {
  enabled?: boolean
  global?: boolean
  keys: ShortcutKeyInput
  onKey?: (key: KeyEvent) => void
}

export function useRegisterShortcuts(bindings: readonly ShortcutBindingSpec[]): void {
  const { registerShortcut } = useKeybind()
  const scopePath = useFocusPath()

  useLayoutEffect(() => {
    const unregisters = expandShortcutBindings(bindings).map((binding) =>
      registerShortcut({
        ...binding,
        scopePath,
      }),
    )

    return () => {
      for (let index = unregisters.length - 1; index >= 0; index -= 1) {
        unregisters[index]!()
      }
    }
  }, [bindings, registerShortcut, scopePath])
}

function expandShortcutBindings(bindings: readonly ShortcutBindingSpec[]) {
  return bindings.flatMap((binding) =>
    parseKeyAlternatives(binding.keys).map((sequence) => ({
      enabled: binding.enabled,
      global: binding.global === true,
      onKey: binding.onKey,
      sequence,
    })),
  )
}
