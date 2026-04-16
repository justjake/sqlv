import { allNavKeys, resolveNavKeyInput, type UseNavKeysOptions } from "./navKeys"
import { useRegisterShortcuts, type ShortcutBindingSpec } from "./useRegisterShortcuts"

const emptyPreventedAliases = new Set<string>()

export function useNavKeys(options: UseNavKeysOptions): void {
  const preventedAliases =
    options.preventAliases && options.preventAliases.length > 0
      ? new Set<string>(options.preventAliases)
      : emptyPreventedAliases

  const bindings: ShortcutBindingSpec[] = []

  for (const navKey of allNavKeys) {
    const handler = options.handlers[navKey]
    if (!handler) {
      continue
    }

    const keys = resolveNavKeyInput(navKey, preventedAliases)
    if (!keys) {
      continue
    }

    bindings.push({
      detect: options.detect,
      enabled: options.enabled,
      global: options.global,
      keys,
      onKey: handler,
    })
  }

  useRegisterShortcuts(bindings)
}
