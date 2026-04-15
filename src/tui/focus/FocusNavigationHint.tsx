import { Text } from "../ui/Text"
import { useTheme } from "../ui/theme"
import { useFocusNavigationState } from "./context"

export function FocusNavigationHint() {
  const theme = useTheme()
  const state = useFocusNavigationState()
  if (!state.active) {
    return null
  }

  return (
    <box
      backgroundColor={theme.focusHintBg}
      border
      borderColor={theme.focusNavBorder}
      bottom={0}
      left={1}
      paddingLeft={1}
      paddingRight={1}
      position="absolute"
      right={1}
      zIndex={100}
    >
      <Text>
        ↑↓←→ Move  Enter Focus  Space Focus
        {state.escLabel ? `  Esc ${state.escLabel}` : "  Esc Cancel"}
      </Text>
    </box>
  )
}
