import { Text } from "../ui/Text"
import { labelizeShortcutInput } from "../ui/keybind"
import { useTheme } from "../ui/theme"
import { useFocusHaloAnimationEase, useFocusNavigationState } from "./context"

const FOCUS_NAV_HINT_Z_INDEX = 1000
const FOCUS_NAV_HINT_SHORTCUT_FG = "#ffffff"
const FOCUS_NAV_HINT_ACTION_FG = "#a7a7a7"
const FOCUS_NAV_MOVE_SHORTCUT = formatCompactShortcutGroup(["up", "down", "left", "right"], ["h", "j", "k", "l"])
const FOCUS_NAV_FOCUS_SHORTCUT = labelizeShortcutInput({ or: ["return", "space"] })
const FOCUS_NAV_CANCEL_SHORTCUT = labelizeShortcutInput("esc")
const FOCUS_NAV_EASING_SHORTCUT = labelizeShortcutInput("e")

export function FocusNavigationHint() {
  const theme = useTheme()
  const state = useFocusNavigationState()
  const easing = useFocusHaloAnimationEase()
  if (!state.active) {
    return null
  }

  return (
    <box
      alignItems="center"
      bottom={1}
      left={0}
      position="absolute"
      right={0}
      zIndex={FOCUS_NAV_HINT_Z_INDEX}
    >
      <box
        backgroundColor={theme.focusHintBg}
        columnGap={2}
        flexDirection="row"
        flexWrap="wrap"
        maxWidth="80%"
        padding={1}
        rowGap={0}
      >
        <Text fg={FOCUS_NAV_HINT_SHORTCUT_FG}>
          <strong>focus nav</strong>
        </Text>
        <HintPair action="move" shortcut={FOCUS_NAV_MOVE_SHORTCUT} />
        <HintPair action="focus" shortcut={FOCUS_NAV_FOCUS_SHORTCUT} />
        <HintPair action={`ease ${easing}`} shortcut={FOCUS_NAV_EASING_SHORTCUT} />
        <HintPair action={formatHintAction(state.escLabel) ?? "cancel"} shortcut={FOCUS_NAV_CANCEL_SHORTCUT} />
      </box>
    </box>
  )
}

function HintPair(props: { action: string; shortcut: string }) {
  return (
    <box flexDirection="row" gap={1}>
      <Text fg={FOCUS_NAV_HINT_SHORTCUT_FG}>{props.shortcut}</Text>
      <Text fg={FOCUS_NAV_HINT_ACTION_FG}>{props.action}</Text>
    </box>
  )
}

function formatHintAction(label: string | undefined): string | undefined {
  return label?.toLowerCase()
}

function formatCompactShortcutGroup(primaryKeys: readonly string[], secondaryKeys?: readonly string[]): string {
  const primaryLabel = primaryKeys.map((key) => labelizeShortcutInput(key)).join("")
  if (!secondaryKeys) {
    return primaryLabel
  }

  const secondaryLabel = secondaryKeys.map((key) => labelizeShortcutInput(key)).join("")
  return `${primaryLabel}/${secondaryLabel}`
}
