import type { InputRenderable } from "@opentui/core"
import type { RefObject } from "react"
import { useTheme } from "../ui/theme"
import { useFormFieldContext } from "./context"

export type TextInputProps = {
  inputRef?: RefObject<InputRenderable | null>
  onInput: (value: string) => void
  placeholder?: string
  value: string
}

export function TextInput(props: TextInputProps) {
  const theme = useTheme()
  const { active, inputFocused } = useFormFieldContext()
  const backgroundColor = active ? theme.formFieldBackgroundActive : theme.formFieldBackground

  return (
    <box alignSelf="stretch" backgroundColor={backgroundColor} flexDirection="row" minWidth={0} width="100%">
      <input
        cursorColor={theme.primaryFg}
        flexGrow={1}
        focused={inputFocused}
        focusedTextColor={theme.primaryFg}
        minWidth={0}
        onInput={props.onInput}
        placeholder={props.placeholder}
        placeholderColor={theme.mutedFg}
        ref={props.inputRef}
        textColor={theme.primaryFg}
        value={props.value}
      />
    </box>
  )
}
