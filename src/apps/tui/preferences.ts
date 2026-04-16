import type { SqlVisorState } from "#api/SqlVisor"

import type { IconStyle } from "./ui/icons"

export type TuiPreferences = {
  iconStyle: IconStyle
}

export const TUI_PREFERENCES_KEY = "preferences"

export function defaultTuiPreferences(): TuiPreferences {
  return {
    iconStyle: "nerdfont",
  }
}

export function getTuiPreferences(state: Pick<SqlVisorState, "appState">): TuiPreferences {
  const stored = state.appState[TUI_PREFERENCES_KEY]
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return defaultTuiPreferences()
  }

  const iconStyle = (stored as { iconStyle?: unknown }).iconStyle
  return {
    iconStyle: iconStyle === "unicode" ? "unicode" : "nerdfont",
  }
}
