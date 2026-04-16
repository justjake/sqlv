import type { KeyEvent } from "@opentui/core"
import { useLayoutEffect, useRef } from "react"
import { useFocusPath } from "../../focus"
import { type KeyStep, parseKeyAlternatives, shortcutKeyInputSignature, type ShortcutKeyInput } from "./shortcutSyntax"
import { useKeybind } from "./useKeybind"

export type ShortcutBindingSpec = {
  detect?: (key: KeyEvent) => boolean
  enabled?: boolean
  global?: boolean
  keys: ShortcutKeyInput
  onKey?: (key: KeyEvent) => void
}

type CompiledShortcutBinding = {
  detect?: (key: KeyEvent) => boolean
  enabled: () => boolean
  global?: boolean
  onKey?: (key: KeyEvent) => void
  sequence: KeyStep[]
}

export function useRegisterShortcuts(bindings: readonly ShortcutBindingSpec[]): void {
  const { registerShortcut } = useKeybind()
  const scopePath = useFocusPath()
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings
  const bindingShapeSignature = buildBindingShapeSignature(bindings)
  const compiledBindingsRef = useRef<{ bindings: readonly CompiledShortcutBinding[]; signature: string } | undefined>(
    undefined,
  )

  if (!compiledBindingsRef.current || compiledBindingsRef.current.signature !== bindingShapeSignature) {
    compiledBindingsRef.current = {
      bindings: bindings.flatMap((binding, bindingIndex) =>
        parseKeyAlternatives(binding.keys).map(
          (sequence): CompiledShortcutBinding => ({
            detect: (key) => {
              const current = bindingsRef.current[bindingIndex]
              if (!current || current.enabled === false) {
                return false
              }
              return current.detect ? current.detect(key) : true
            },
            enabled: () => bindingsRef.current[bindingIndex]?.enabled !== false,
            global: binding.global === true,
            onKey: (key) => bindingsRef.current[bindingIndex]?.onKey?.(key),
            sequence,
          }),
        ),
      ),
      signature: bindingShapeSignature,
    }
  }

  useLayoutEffect(() => {
    const unregisters = compiledBindingsRef.current!.bindings.map((binding) =>
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
  }, [bindingShapeSignature, registerShortcut, scopePath])
}

function buildBindingShapeSignature(bindings: readonly ShortcutBindingSpec[]): string {
  return bindings
    .map((binding) => `${binding.global === true ? "1" : "0"}:${shortcutKeyInputSignature(binding.keys) ?? ""}`)
    .join("\u0000")
}
