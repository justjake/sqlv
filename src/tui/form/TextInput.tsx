import type { InputRenderable } from "@opentui/core"
import type { RefObject } from "react"
import { useTheme } from "../ui/theme"
import { useFormFieldContext } from "./context"

export type TextInputProps = {
  disabled?: boolean
  inputRef?: RefObject<InputRenderable | null>
  onInput: (value: string) => void
  placeholder?: string
  value: string
}

export function TextInput(props: TextInputProps) {
  const theme = useTheme()
  const { active, inputFocused } = useFormFieldContext()
  const backgroundColor = active ? theme.formFieldBackgroundActive : theme.formFieldBackground
  const editable = !props.disabled

  return (
    <box alignSelf="stretch" backgroundColor={backgroundColor} flexDirection="row" minWidth={0} width="100%">
      <input
        cursorColor={theme.primaryFg}
        flexGrow={1}
        focused={editable && inputFocused}
        focusedTextColor={theme.primaryFg}
        minWidth={0}
        onInput={editable ? props.onInput : undefined}
        placeholder={props.placeholder}
        placeholderColor={theme.mutedFg}
        ref={props.inputRef}
        textColor={editable ? theme.primaryFg : theme.mutedFg}
        value={props.value}
      />
    </box>
  )
}
