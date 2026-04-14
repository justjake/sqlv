import type { CliRenderer, TerminalColors, ThemeMode } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

// ── Semantic color tokens ───────────────────────────────────────────────────

type Theme = {
  /** Background for focused/selected rows (tree nodes, history items, form fields). */
  focusBg: string
  /** Background for the highlighted target while focus navigation mode is active. */
  focusNavBg: string
  /** Border color for focus navigation halos and hint chrome. */
  focusNavBorder: string
  /** Background for the focus navigation hint panel. */
  focusHintBg: string
  /** Background for interactive input fields. */
  inputBg: string
  /** Background for shortcut badges in their default state. */
  shortcutBg: string
  /** Background for shortcut badges when activated. */
  shortcutActiveBg: string
  /** Border color for separators/dividers at rest. */
  borderColor: string
  /** Border color for separators/dividers when hovered or dragged. */
  borderHoverColor: string
  /** Foreground for tree guides and other structural decoration. */
  mutedFg: string
}

// ── Hardcoded fallbacks ─────────────────────────────────────────────────────
// Dark values are taken from the user's WezTerm "Circus (base16)" palette.
// Light values are reasonable counterparts for a light-background terminal.

const DARK: Theme = {
  focusBg: "#639ee4", // base0D (blue)
  focusNavBg: "#8ab6ef",
  focusNavBorder: "#d0d0d0",
  focusHintBg: "#1f1f1f",
  inputBg: "#303030", // base02
  shortcutBg: "#5f5a60", // base03
  shortcutActiveBg: "#639ee4", // base0D
  borderColor: "#5f5a60", // base03
  borderHoverColor: "#a7a7a7", // base05
  mutedFg: "#5f5a60", // base03
}

const LIGHT: Theme = {
  focusBg: "#4271ae",
  focusNavBg: "#6f95c7",
  focusNavBorder: "#303030",
  focusHintBg: "#f3f3f3",
  inputBg: "#e0e0e0",
  shortcutBg: "#c8c8c8",
  shortcutActiveBg: "#4271ae",
  borderColor: "#c8c8c8",
  borderHoverColor: "#505050",
  mutedFg: "#999999",
}

// ── Palette → theme mapping ─────────────────────────────────────────────────

function themeFromPalette(palette: TerminalColors, mode: ThemeMode): Theme {
  const p = palette.palette
  if (mode === "light") {
    return {
      focusBg: p[4] ?? LIGHT.focusBg, // ANSI blue
      focusNavBg: p[12] ?? brighten(p[4] ?? LIGHT.focusBg, 0.2),
      focusNavBorder: p[0] ?? LIGHT.focusNavBorder,
      focusHintBg: p[7] ?? LIGHT.focusHintBg,
      inputBg: p[7] ?? LIGHT.inputBg, // ANSI white (light bg tint)
      shortcutBg: p[7] ?? LIGHT.shortcutBg,
      shortcutActiveBg: p[4] ?? LIGHT.shortcutActiveBg,
      borderColor: p[7] ?? LIGHT.borderColor,
      borderHoverColor: p[8] ?? LIGHT.borderHoverColor,
      mutedFg: p[8] ?? LIGHT.mutedFg, // ANSI bright black
    }
  }
  return {
    focusBg: p[4] ?? DARK.focusBg, // ANSI blue
    focusNavBg: p[12] ?? brighten(p[4] ?? DARK.focusBg, 0.18),
    focusNavBorder: p[7] ?? DARK.focusNavBorder,
    focusHintBg: p[0] ? brighten(p[0], 0.08) : DARK.focusHintBg,
    inputBg: p[0] ? brighten(p[0], 0.12) : DARK.inputBg,
    shortcutBg: p[8] ?? DARK.shortcutBg, // ANSI bright black
    shortcutActiveBg: p[4] ?? DARK.shortcutActiveBg,
    borderColor: p[8] ?? DARK.borderColor,
    borderHoverColor: p[7] ?? DARK.borderHoverColor,
    mutedFg: p[8] ?? DARK.mutedFg,
  }
}

// ── Context ─────────────────────────────────────────────────────────────────

const ThemeContext = createContext<Theme>(DARK)

export function useTheme(): Theme {
  return useContext(ThemeContext)
}

export function ThemeProvider(props: { children: ReactNode }) {
  const renderer = useRenderer() as CliRenderer
  const mode = renderer.themeMode ?? "dark"
  const fallback = mode === "light" ? LIGHT : DARK
  const [theme, setTheme] = useState<Theme>(fallback)

  useEffect(() => {
    let cancelled = false
    renderer.getPalette().then((colors) => {
      if (!cancelled) setTheme(themeFromPalette(colors, mode))
    })
    return () => {
      cancelled = true
    }
  }, [renderer, mode])

  return <ThemeContext value={theme}>{props.children}</ThemeContext>
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Nudge a hex color brighter by `amount` (0-1). */
function brighten(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const bump = (c: number) => Math.min(255, Math.round(c + (255 - c) * amount))
  return `#${bump(r).toString(16).padStart(2, "0")}${bump(g).toString(16).padStart(2, "0")}${bump(b).toString(16).padStart(2, "0")}`
}
