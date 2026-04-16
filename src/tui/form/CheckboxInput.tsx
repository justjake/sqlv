import type { ReactNode } from "react"
import { Focusable, useIsFocusNavigationActive, useIsFocused, useIsHighlighted } from "../focus"
import { Text } from "../ui/Text"
import { useShortcut } from "../ui/keybind"
import { useTheme } from "../ui/theme"

export type CheckboxInputProps = {
  active?: boolean
  checked: boolean
  checkedLabel?: ReactNode
  disabled?: boolean
  focusableId?: string
  hint?: ReactNode
  onChange?: (value: boolean) => void
  uncheckedLabel?: ReactNode
}

const DEFAULT_INPUT_ID = "input"

export function CheckboxInput(props: CheckboxInputProps) {
  return (
    <Focusable
      alignSelf="stretch"
      focusSelf
      focusable
      focusableId={props.focusableId ?? DEFAULT_INPUT_ID}
      hideNavigationHalo
      minWidth={0}
      width="100%"
    >
      <CheckboxInputBody {...props} />
    </Focusable>
  )
}

function CheckboxInputBody(props: CheckboxInputProps) {
  const theme = useTheme()
  const focused = useIsFocused()
  const highlighted = useIsHighlighted()
  const navigationActive = useIsFocusNavigationActive()
  const active = props.active ?? (navigationActive ? highlighted : focused)
  const inputFocused = focused && !navigationActive
  const backgroundColor = active ? theme.formFieldBackgroundActive : theme.formFieldBackground
  const interactive = !props.disabled && !!props.onChange
  const indicatorColor = props.disabled ? theme.mutedFg : active ? theme.focusPrimaryFg : undefined
  const labelColor = props.disabled ? theme.mutedFg : undefined

  useShortcut({
    enabled: inputFocused && interactive,
    keys: { or: ["space", "return"] },
    onKey(event) {
      event.preventDefault()
      event.stopPropagation()
      props.onChange?.(!props.checked)
    },
  })

  return (
    <box
      alignSelf="stretch"
      backgroundColor={backgroundColor}
      flexDirection="row"
      gap={1}
      minWidth={0}
      onMouseUp={interactive ? () => props.onChange?.(!props.checked) : undefined}
      width="100%"
    >
      <Text fg={indicatorColor} wrapMode="none">
        {props.checked ? "◉" : "○"}
      </Text>
      <Text fg={labelColor} flexGrow={1} flexShrink={1} truncate wrapMode="none">
        {props.checked ? (props.checkedLabel ?? "Enabled") : (props.uncheckedLabel ?? "Disabled")}
      </Text>
      {inputFocused && interactive && props.hint ? <Text fg={theme.mutedFg}>{props.hint}</Text> : null}
    </box>
  )
}
