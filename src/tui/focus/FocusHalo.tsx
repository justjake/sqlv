import { useTheme } from "../ui/theme"
import { useIsFocusNavigationActive, useIsHighlighted } from "./context"

export function FocusHalo() {
  const theme = useTheme()
  const active = useIsFocusNavigationActive()
  const highlighted = useIsHighlighted()

  if (!active || !highlighted) {
    return null
  }

  return (
    <box
      border
      borderColor={theme.focusNavBorder}
      bottom={0}
      left={0}
      position="absolute"
      right={0}
      top={0}
      zIndex={1}
    />
  )
}
