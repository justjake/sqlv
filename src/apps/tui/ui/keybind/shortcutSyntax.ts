import type { KeyEvent } from "@opentui/core"
import {
  normalizeShortcutKeyName,
  type ShortcutKeyUnion as BaseShortcutKeyUnion,
  type ShortcutKeys,
} from "../shortcutKeys"

export type KeyStep = {
  ctrl?: boolean
  meta?: boolean
  name?: string
  option?: boolean
  shift?: boolean
  super?: boolean
}

export type ShortcutSequenceInput = string | ShortcutKeys
export type ShortcutKeyUnion = BaseShortcutKeyUnion<ShortcutSequenceInput>
export type ShortcutKeyInput = ShortcutSequenceInput | ShortcutKeyUnion

const collapsedCtrlSymbolNames = {
  "\u0000": ["@", "space"],
  "\u001b": ["[", "esc"],
  "\u001c": [",", "\\"],
  "\u001d": ["]"],
  "\u001e": [".", "^"],
  "\u001f": ["/", "-", "_", "?"],
} as const satisfies Record<string, readonly string[]>

export function stepMatches(step: KeyStep, event: KeyEvent): boolean {
  if (matchesCollapsedCtrlSymbol(step, event)) {
    return true
  }
  if (step.name !== undefined && !keyNameMatches(step.name, event.name)) {
    return false
  }
  if (!!step.ctrl !== !!event.ctrl) {
    return false
  }
  if (!!step.shift !== !!event.shift) {
    return false
  }
  if (!!step.meta !== !!event.meta) {
    return false
  }
  if (!!step.super !== !!event.super) {
    return false
  }
  return true
}

export function sequenceEquals(a: readonly KeyStep[], b: readonly KeyStep[]): boolean {
  if (a.length !== b.length) {
    return false
  }

  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]!
    const right = b[index]!

    if (left.name !== undefined || right.name !== undefined) {
      if (left.name === undefined || right.name === undefined) {
        return false
      }
      if (!keyNameMatches(left.name, right.name)) {
        return false
      }
    }

    if (!!left.ctrl !== !!right.ctrl) {
      return false
    }
    if (!!left.shift !== !!right.shift) {
      return false
    }
    if (!!left.meta !== !!right.meta) {
      return false
    }
    if (!!left.super !== !!right.super) {
      return false
    }
  }

  return true
}

export function eventToStep(event: KeyEvent): KeyStep {
  return {
    ctrl: event.ctrl,
    meta: event.meta,
    name: event.name,
    option: event.option,
    shift: event.shift,
    super: event.super,
  }
}

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

export function parseKeyAlternatives(input: ShortcutKeyInput): KeyStep[][] {
  return shortcutKeyAlternatives(input).map((item) => parseShortcutSequence(item))
}

export function shortcutKeyInputSignature(input: ShortcutKeyInput | undefined): string | undefined {
  if (input === undefined) {
    return undefined
  }

  return shortcutKeyAlternatives(input)
    .map((sequence) => shortcutSequenceSignature(sequence))
    .join("\u0000")
}

export function labelizeSequence(sequence: readonly KeyStep[]): string {
  return sequence
    .map((step) => {
      let label = ""
      if (step.ctrl) {
        label += "⌃"
      }
      if (step.option) {
        label += "⌥"
      } else if (step.meta) {
        label += "alt+"
      }
      if (step.shift) {
        label += "⇧"
      }
      if (step.super) {
        label += "⌘"
      }
      if (step.name) {
        label += labelizeKeyName(step.name)
      }
      return label
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

function parseShortcutSequence(input: ShortcutSequenceInput): KeyStep[] {
  if (typeof input === "string") {
    return parseKeys(input)
  }

  return input.flatMap((item) => parseKeys(item))
}

type CtrlSuperVariant = "ctrl" | "other" | "super"

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
