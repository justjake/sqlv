import type { InputRenderable } from "@opentui/core"
import type { RefObject } from "react"
import { useFormFieldContext } from "./context"
import { useTheme } from "../ui/theme"

export type FormInputProps = {
  inputRef?: RefObject<InputRenderable | null>
  onInput: (value: string) => void
  placeholder?: string
  value: string
}

export function FormInput(props: FormInputProps) {
  const theme = useTheme()
  const { active, inputFocused } = useFormFieldContext()

  return (
    <box alignSelf="stretch" flexDirection="row" minWidth={0}>
      <input
        backgroundColor={active ? theme.formFieldBackgroundActive : theme.formFieldBackground}
        cursorColor={theme.primaryFg}
        flexGrow={1}
        focused={inputFocused}
        focusedBackgroundColor={theme.formFieldBackgroundActive}
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
