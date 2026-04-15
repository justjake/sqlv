import type { ReactNode } from "react"
import { Text } from "../ui/Text"
import { useKeybindHandler } from "../ui/keybind"
import { useTheme } from "../ui/theme"
import { useFormFieldContext } from "./context"

export type CheckboxInputProps = {
  checked: boolean
  checkedLabel?: ReactNode
  disabled?: boolean
  hint?: ReactNode
  onChange?: (value: boolean) => void
  uncheckedLabel?: ReactNode
}

export function CheckboxInput(props: CheckboxInputProps) {
  const theme = useTheme()
  const { active, inputFocused } = useFormFieldContext()
  const backgroundColor = active ? theme.formFieldBackgroundActive : theme.formFieldBackground
  const interactive = !props.disabled && !!props.onChange
  const indicatorColor = props.disabled ? theme.mutedFg : active ? theme.focusPrimaryFg : undefined
  const labelColor = props.disabled ? theme.mutedFg : undefined

  useKeybindHandler({
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
