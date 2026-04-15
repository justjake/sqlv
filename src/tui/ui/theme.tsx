import type { CliRenderer, TerminalColors, ThemeMode } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

// ── Semantic color tokens ───────────────────────────────────────────────────

type Theme = {
  /** Default background for neutral app surfaces and modal panels. */
  backgroundBg: string
  /** Backdrop for modal overlays. */
  modalBackdropBg: string
  /** Foreground for ordinary body text and input text. */
  primaryFg: string
  /** Foreground for focus-accented indicators such as selected radio dots. */
  focusPrimaryFg: string
  /** Foreground for an active form field label. */
  formFieldLabelActiveFg: string
  /** Background for focused/selected rows (tree nodes, history items, form fields). */
  focusBg: string
  /** Background for the highlighted target while focus navigation mode is active. */
  focusNavBg: string
  /** Transparent overlay background for the highlighted target while focus navigation mode is active. */
  focusNavHaloBg: string
  /** Border color for focus navigation halos and hint chrome. */
  focusNavBorder: string
  /** Background for the focus navigation hint panel. */
  focusHintBg: string
  /** Background for interactive input fields. */
  inputBg: string
  /** Border color for idle form fields. */
  formFieldFocusRingInactive: string
  /** Border color for active form fields. */
  formFieldFocusRingActive: string
  /** Background for idle form fields. */
  formFieldBackground: string
  /** Background for active form fields. */
  formFieldBackgroundActive: string
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
  /** Foreground for successful query state. */
  successFg: string
  /** Foreground for warning or in-progress query state. */
  warningFg: string
  /** Foreground for failed query state. */
  errorFg: string
}

// ── Hardcoded fallbacks ─────────────────────────────────────────────────────
// Dark values are taken from the user's WezTerm "Circus (base16)" palette.
// Light values are reasonable counterparts for a light-background terminal.

const FORM_FIELD_BACKGROUND_ALPHA = 0x38
const FORM_FIELD_BACKGROUND_ACTIVE_ALPHA = 0x5a
const FOCUS_NAV_HALO_ALPHA = 0x24
const MODAL_BACKDROP_ALPHA = 0x96

const DARK: Theme = {
  backgroundBg: "#151515",
  modalBackdropBg: withHexAlpha("#151515", MODAL_BACKDROP_ALPHA),
  primaryFg: "#d0d0d0",
  focusPrimaryFg: "#639ee4", // base0D (blue)
  formFieldLabelActiveFg: "#ffffff",
  focusBg: "#639ee4", // base0D (blue)
  focusNavBg: "#8ab6ef",
  focusNavHaloBg: withHexAlpha("#8ab6ef", FOCUS_NAV_HALO_ALPHA),
  focusNavBorder: "#d0d0d0",
  focusHintBg: "#1f1f1f",
  inputBg: "#303030", // base02
  formFieldFocusRingInactive: "#5f5a60", // base03
  formFieldFocusRingActive: "#8ab6ef",
  formFieldBackground: withHexAlpha("#303030", FORM_FIELD_BACKGROUND_ALPHA),
  formFieldBackgroundActive: withHexAlpha("#3a3a3a", FORM_FIELD_BACKGROUND_ACTIVE_ALPHA),
  shortcutBg: "#5f5a60", // base03
  shortcutActiveBg: "#639ee4", // base0D
  borderColor: "#5f5a60", // base03
  borderHoverColor: "#a7a7a7", // base05
  mutedFg: "#5f5a60", // base03
  successFg: "#84d084",
  warningFg: "#f0c674",
  errorFg: "#ff7b72",
}

const LIGHT: Theme = {
  backgroundBg: "#ffffff",
  modalBackdropBg: withHexAlpha("#ffffff", MODAL_BACKDROP_ALPHA),
  primaryFg: "#303030",
  focusPrimaryFg: "#4271ae",
  formFieldLabelActiveFg: "#111111",
  focusBg: "#4271ae",
  focusNavBg: "#6f95c7",
  focusNavHaloBg: withHexAlpha("#6f95c7", FOCUS_NAV_HALO_ALPHA),
  focusNavBorder: "#303030",
  focusHintBg: "#f3f3f3",
  inputBg: "#e0e0e0",
  formFieldFocusRingInactive: "#c8c8c8",
  formFieldFocusRingActive: "#4271ae",
  formFieldBackground: withHexAlpha("#efefef", FORM_FIELD_BACKGROUND_ALPHA),
  formFieldBackgroundActive: withHexAlpha("#ffffff", FORM_FIELD_BACKGROUND_ACTIVE_ALPHA),
  shortcutBg: "#c8c8c8",
  shortcutActiveBg: "#4271ae",
  borderColor: "#c8c8c8",
  borderHoverColor: "#505050",
  mutedFg: "#999999",
  successFg: "#2f9e44",
  warningFg: "#b7791f",
  errorFg: "#c53030",
}

// ── Palette → theme mapping ─────────────────────────────────────────────────

function themeFromPalette(palette: TerminalColors, mode: ThemeMode): Theme {
  const p = palette.palette
  if (mode === "light") {
    const backgroundBg = palette.defaultBackground ?? p[7] ?? LIGHT.backgroundBg

    return {
      backgroundBg,
      modalBackdropBg: withHexAlpha(backgroundBg, MODAL_BACKDROP_ALPHA),
      primaryFg: palette.defaultForeground ?? p[0] ?? LIGHT.primaryFg,
      focusPrimaryFg: p[4] ?? LIGHT.focusPrimaryFg, // ANSI blue
      formFieldLabelActiveFg: p[0] ?? LIGHT.formFieldLabelActiveFg,
      focusBg: p[4] ?? LIGHT.focusBg, // ANSI blue
      focusNavBg: p[12] ?? brighten(p[4] ?? LIGHT.focusBg, 0.2),
      focusNavHaloBg: withHexAlpha(p[12] ?? brighten(p[4] ?? LIGHT.focusBg, 0.2), FOCUS_NAV_HALO_ALPHA),
      focusNavBorder: p[0] ?? LIGHT.focusNavBorder,
      focusHintBg: p[7] ?? LIGHT.focusHintBg,
      inputBg: p[7] ?? LIGHT.inputBg, // ANSI white (light bg tint)
      formFieldFocusRingInactive: p[7] ?? LIGHT.formFieldFocusRingInactive,
      formFieldFocusRingActive: p[4] ?? LIGHT.formFieldFocusRingActive,
      formFieldBackground: withHexAlpha(p[7] ?? LIGHT.formFieldBackground, FORM_FIELD_BACKGROUND_ALPHA),
      formFieldBackgroundActive: withHexAlpha(
        p[7] ? brighten(p[7], 0.04) : LIGHT.formFieldBackgroundActive,
        FORM_FIELD_BACKGROUND_ACTIVE_ALPHA,
      ),
      shortcutBg: p[7] ?? LIGHT.shortcutBg,
      shortcutActiveBg: p[4] ?? LIGHT.shortcutActiveBg,
      borderColor: p[7] ?? LIGHT.borderColor,
      borderHoverColor: p[8] ?? LIGHT.borderHoverColor,
      mutedFg: p[8] ?? LIGHT.mutedFg, // ANSI bright black
      successFg: p[2] ?? LIGHT.successFg,
      warningFg: p[3] ?? LIGHT.warningFg,
      errorFg: p[1] ?? LIGHT.errorFg,
    }
  }
  const backgroundBg = palette.defaultBackground ?? p[0] ?? DARK.backgroundBg

  return {
    backgroundBg,
    modalBackdropBg: withHexAlpha(backgroundBg, MODAL_BACKDROP_ALPHA),
    primaryFg: palette.defaultForeground ?? p[7] ?? DARK.primaryFg,
    focusPrimaryFg: p[4] ?? DARK.focusPrimaryFg, // ANSI blue
    formFieldLabelActiveFg: "#ffffff",
    focusBg: p[4] ?? DARK.focusBg, // ANSI blue
    focusNavBg: p[12] ?? brighten(p[4] ?? DARK.focusBg, 0.18),
    focusNavHaloBg: withHexAlpha(p[12] ?? brighten(p[4] ?? DARK.focusBg, 0.18), FOCUS_NAV_HALO_ALPHA),
    focusNavBorder: p[7] ?? DARK.focusNavBorder,
    focusHintBg: p[0] ? brighten(p[0], 0.08) : DARK.focusHintBg,
    inputBg: p[0] ? brighten(p[0], 0.12) : DARK.inputBg,
    formFieldFocusRingInactive: p[8] ?? DARK.formFieldFocusRingInactive,
    formFieldFocusRingActive: p[12] ?? p[4] ?? DARK.formFieldFocusRingActive,
    formFieldBackground: withHexAlpha(
      p[0] ? brighten(p[0], 0.12) : DARK.formFieldBackground,
      FORM_FIELD_BACKGROUND_ALPHA,
    ),
    formFieldBackgroundActive: withHexAlpha(
      p[0] ? brighten(p[0], 0.18) : DARK.formFieldBackgroundActive,
      FORM_FIELD_BACKGROUND_ACTIVE_ALPHA,
    ),
    shortcutBg: p[8] ?? DARK.shortcutBg, // ANSI bright black
    shortcutActiveBg: p[4] ?? DARK.shortcutActiveBg,
    borderColor: p[8] ?? DARK.borderColor,
    borderHoverColor: p[7] ?? DARK.borderHoverColor,
    mutedFg: p[8] ?? DARK.mutedFg,
    successFg: p[2] ?? DARK.successFg,
    warningFg: p[3] ?? DARK.warningFg,
    errorFg: p[1] ?? DARK.errorFg,
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

function withHexAlpha(color: string, alpha: number): string {
  if (!/^#[\da-fA-F]{6}([\da-fA-F]{2})?$/.test(color)) {
    return color
  }

  return `${color.slice(0, 7)}${alpha.toString(16).padStart(2, "0")}`
}
