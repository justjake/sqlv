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
  const { inputFocused } = useFormFieldContext()

  return (
    <box flexDirection="row" width="100%">
      <input
        cursorColor={theme.primaryFg}
        flexGrow={1}
        focused={inputFocused}
        focusedTextColor={theme.primaryFg}
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
