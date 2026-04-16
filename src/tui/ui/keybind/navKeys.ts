import type { KeyEvent } from "@opentui/core"
import type { ShortcutModifiedKey, ShortcutModifiers } from "../shortcutKeys"
import type { ShortcutKeyInput } from "./shortcutSyntax"

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
export type NavKeyHandler = (key: KeyEvent) => void
export type NavHandlers = Partial<Record<NavKey, NavKeyHandler>>

export type UseNavKeysOptions = {
  detect?: (key: KeyEvent) => boolean
  enabled?: boolean
  global?: boolean
  handlers: NavHandlers
  preventAliases?: readonly AliasedByNavKey[]
}

const navKeyNames = Object.keys(NavKeyAlias) as NavKeyName[]
const navKeyModifierPrefixes = buildNavKeyModifierPrefixes()

export const allNavKeys = navKeyModifierPrefixes.flatMap((prefix) =>
  navKeyNames.map((name) => `${prefix}${name}` as NavKey),
)

export function translateNavKey(navKey: NavKey): ShortcutKeyInput {
  const { modifiers, name } = splitNavKey(navKey)
  const translatedKeys = NavKeyAlias[name].map((key) => `${modifiers}${key}` as ShortcutModifiedKey)
  return alternativesToShortcutKeyInput(translatedKeys)
}

export function resolveNavKeyInput(
  navKey: NavKey,
  preventedAliases: ReadonlySet<string>,
): ShortcutKeyInput | undefined {
  const translatedKeys = NavKeyAlias[splitNavKey(navKey).name]
    .map((key) => `${splitNavKey(navKey).modifiers}${key}` as ShortcutModifiedKey)
    .filter((key) => !preventedAliases.has(key))

  if (translatedKeys.length === 0) {
    return undefined
  }

  return alternativesToShortcutKeyInput(translatedKeys)
}

function alternativesToShortcutKeyInput(keys: readonly ShortcutModifiedKey[]): ShortcutKeyInput {
  if (keys.length === 1) {
    return keys[0]!
  }

  return { or: keys }
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

function splitNavKey(navKey: NavKey): { modifiers: ShortcutModifiers; name: NavKeyName } {
  const lastPlus = navKey.lastIndexOf("+")
  const modifiers = (lastPlus === -1 ? "" : navKey.slice(0, lastPlus + 1)) as ShortcutModifiers
  const name = (lastPlus === -1 ? navKey : navKey.slice(lastPlus + 1)) as NavKeyName

  if (!Object.hasOwn(NavKeyAlias, name)) {
    throw new Error(`Unknown nav key: ${navKey}`)
  }

  return { modifiers, name }
}
