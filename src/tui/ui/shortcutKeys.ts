/**
 * Shortcut key names derived from OpenTUI's parser ground truth:
 * - packages/core/src/lib/parse.keypress.ts
 * - packages/core/src/lib/parse.keypress-kitty.ts
 * - packages/core/src/lib/keymapping.ts
 *
 * `ShortcutKeys` models the keys we can represent in sqlv's shortcut/chord
 * syntax today. Delimiter characters like bare `+` use a spelled alias in
 * the input grammar, for example `plus`.
 *
 * Public canonical spellings:
 * - `esc` over `escape`
 * - `return` over `enter`
 */

export const shortcutLetterKeyNames = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
] as const

export const shortcutDigitKeyNames = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const

export const shortcutNormalizedSymbolKeyNames = [
  "!",
  '"',
  "#",
  "$",
  "%",
  "&",
  "'",
  "(",
  ")",
  "*",
  "+",
  ",",
  "-",
  ".",
  "/",
  ":",
  ";",
  "<",
  "=",
  ">",
  "?",
  "@",
  "[",
  "\\",
  "]",
  "^",
  "_",
  "`",
  "{",
  "|",
  "}",
  "~",
] as const

// Bare `+` is a modifier separator in the shortcut string grammar, so its
// spelled alias `plus` is used in shortcut inputs.
export const shortcutInputSymbolKeyNames = [
  "!",
  '"',
  "#",
  "$",
  "%",
  "&",
  "'",
  "(",
  ")",
  "*",
  ",",
  "-",
  ".",
  "/",
  ":",
  ";",
  "<",
  "=",
  ">",
  "?",
  "@",
  "[",
  "\\",
  "]",
  "^",
  "_",
  "`",
  "{",
  "|",
  "}",
  "~",
] as const

export const shortcutAliasKeyNames = ["plus"] as const

export const shortcutNamedKeyNames = [
  "backspace",
  "capslock",
  "clear",
  "delete",
  "down",
  "end",
  "esc",
  "home",
  "insert",
  "iso_level3_shift",
  "iso_level5_shift",
  "left",
  "leftalt",
  "leftctrl",
  "lefthyper",
  "leftmeta",
  "leftshift",
  "leftsuper",
  "linefeed",
  /*
  "mediapause",
  "mediafastforward",
  "mediaplay",
  "mediaplaypause",
  "mediaprev",
  "mediarecord",
  "mediareverse",
  "mediarewind",
  "mediastop",
  "medianext",
  */
  "menu",
  "mute",
  "numlock",
  "pageup",
  "pagedown",
  "pause",
  "printscreen",
  "return",
  "right",
  "rightalt",
  "rightctrl",
  "righthyper",
  "rightmeta",
  "rightshift",
  "rightsuper",
  "scrolllock",
  "space",
  "tab",
  "up",
  "volumedown",
  "volumeup",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
  "f13",
  "f14",
  // Not worth the union complexity
  /*
  "f15",
  "f16",
  "f17",
  "f18",
  "f19",
  "f20",
  "f21",
  "f22",
  "f23",
  "f24",
  "f25",
  "f26",
  "f27",
  "f28",
  "f29",
  "f30",
  "f31",
  "f32",
  "f33",
  "f34",
  "f35",
  "kp0",
  "kp1",
  "kp2",
  "kp3",
  "kp4",
  "kp5",
  "kp6",
  "kp7",
  "kp8",
  "kp9",
  "kpdecimal",
  "kpdivide",
  "kpmultiply",
  "kpminus",
  "kpplus",
  "kpenter",
  "kpequal",
  "kpseparator",
  "kpleft",
  "kpright",
  "kpup",
  "kpdown",
  "kppageup",
  "kppagedown",
  "kphome",
  "kpend",
  "kpinsert",
  "kpdelete",
  */
] as const

// `alt` and `option` are intentionally both accepted:
// OpenTUI always sets `meta` for Alt/Option, but only sets `option` when the
// terminal reports an explicit Alt/Option modifier bit.
export const shortcutModifierNames = ["ctrl", "shift", "meta", "alt", "option"] as const

export const shortcutBareKeyNames = [
  ...shortcutLetterKeyNames,
  ...shortcutDigitKeyNames,
  ...shortcutInputSymbolKeyNames,
  ...shortcutAliasKeyNames,
  ...shortcutNamedKeyNames,
] as const

export type ShortcutLetterKeyName = (typeof shortcutLetterKeyNames)[number]
export type ShortcutDigitKeyName = (typeof shortcutDigitKeyNames)[number]
export type ShortcutNormalizedSymbolKeyName = (typeof shortcutNormalizedSymbolKeyNames)[number]
export type ShortcutInputSymbolKeyName = (typeof shortcutInputSymbolKeyNames)[number]
export type ShortcutNamedKeyName = (typeof shortcutNamedKeyNames)[number]
export type ShortcutModifierName = (typeof shortcutModifierNames)[number]

export type ShortcutNormalizedKeyName =
  | ShortcutLetterKeyName
  | ShortcutDigitKeyName
  | ShortcutNormalizedSymbolKeyName
  | ShortcutNamedKeyName

export type ShortcutBareKeyName = (typeof shortcutBareKeyNames)[number]

// In macOS display order.
export type Ctrl = `ctrl+`
export type Option = `option+` // | `meta+` | `alt+`
export type Shift = `shift+`
export type Command = `command+`
// No Command detected

export type ShortcutModifiedKey =
  `${Ctrl | never}${Option | never}${Shift | never}${Command | never}${ShortcutBareKeyName}`
export type ShortcutChain = [ShortcutModifiedKey, ...ShortcutModifiedKey[]]
export type ShortcutKeys = ShortcutModifiedKey | ShortcutChain

export const shortcutKeyAliases = {
  enter: "return",
  escape: "esc",
  plus: "+",
  kp0: "0",
  kp1: "1",
  kp2: "2",
  kp3: "3",
  kp4: "4",
  kp5: "5",
  kp6: "6",
  kp7: "7",
  kp8: "8",
  kp9: "9",
  kpdecimal: ".",
  kpdivide: "/",
  kpmultiply: "*",
  kpminus: "-",
  kpplus: "+",
  kpenter: "return",
  kpequal: "=",
  kpseparator: ",",
  kpleft: "left",
  kpright: "right",
  kpup: "up",
  kpdown: "down",
  kppageup: "pageup",
  kppagedown: "pagedown",
  kphome: "home",
  kpend: "end",
  kpinsert: "insert",
  kpdelete: "delete",
  command: "super",
} as const satisfies Record<string, ShortcutNormalizedKeyName>

export function normalizeShortcutKeyName(name: string | undefined): string | undefined {
  if (!name) {
    return undefined
  }

  const normalized = name === " " ? "space" : name.toLowerCase()
  return shortcutKeyAliases[normalized as keyof typeof shortcutKeyAliases] ?? normalized
}
