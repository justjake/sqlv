import type { InputRenderable } from "@opentui/core"
import { useRef } from "react"
import { Focusable, useIsFocusNavigationActive, useIsFocused, useIsHighlighted } from "../focus"
import { useTheme } from "../ui/theme"

export type TextInputProps = {
  active?: boolean
  disabled?: boolean
  focusableId?: string
  onInput: (value: string) => void
  placeholder?: string
  value: string
}

const DEFAULT_INPUT_ID = "input"

export function TextInput(props: TextInputProps) {
  const inputRef = useRef<InputRenderable>(null)

  return (
    <Focusable
      alignSelf="stretch"
      applyFocus={props.disabled ? undefined : () => inputRef.current?.focus()}
      focusSelf={props.disabled}
      focusable
      focusableId={props.focusableId ?? DEFAULT_INPUT_ID}
      hideNavigationHalo
      minWidth={0}
      width="100%"
    >
      <TextInputBody {...props} inputRef={inputRef} />
    </Focusable>
  )
}

function TextInputBody(props: TextInputProps & { inputRef: { current: InputRenderable | null } }) {
  const theme = useTheme()
  const focused = useIsFocused()
  const highlighted = useIsHighlighted()
  const navigationActive = useIsFocusNavigationActive()
  const active = props.active ?? (navigationActive ? highlighted : focused)
  const inputFocused = focused && !navigationActive
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
