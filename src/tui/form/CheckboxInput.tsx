import type { ReactNode } from "react"
import { Text } from "../ui/Text"
import { useKeybindHandler } from "../ui/keybind"
import { useTheme } from "../ui/theme"
import { useFormFieldContext } from "./context"

export type CheckboxInputProps = {
  checked: boolean
  checkedLabel?: ReactNode
  hint?: ReactNode
  onChange?: (value: boolean) => void
  uncheckedLabel?: ReactNode
}

export function CheckboxInput(props: CheckboxInputProps) {
  const theme = useTheme()
  const { active, inputFocused } = useFormFieldContext()
  const backgroundColor = active ? theme.formFieldBackgroundActive : theme.formFieldBackground

  useKeybindHandler({
    enabled: inputFocused && !!props.onChange,
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
      onMouseUp={props.onChange ? () => props.onChange?.(!props.checked) : undefined}
      width="100%"
    >
      <Text fg={active ? theme.focusPrimaryFg : undefined} wrapMode="none">
        {props.checked ? "◉" : "○"}
      </Text>
      <Text flexGrow={1} flexShrink={1} truncate wrapMode="none">
        {props.checked ? (props.checkedLabel ?? "Enabled") : (props.uncheckedLabel ?? "Disabled")}
      </Text>
      {inputFocused && props.hint ? <Text fg={theme.mutedFg}>{props.hint}</Text> : null}
    </box>
  )
}
