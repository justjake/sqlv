import type { ReactNode } from "react"
import { useShortcut } from "../ui/keybind/useShortcut"
import { useTheme } from "../ui/theme"
import { Focusable } from "../focus/Focusable"
import { useIsFocusNavigationActive, useIsFocused, useIsHighlighted } from "../focus/context"
import { Text } from "../ui/Text"
import { renderSelectOptionLabel } from "./selectOptionLabel"

export type SelectOption<Value extends string = string> = {
  label: ReactNode
  value: Value
}

export type SelectInputProps<Value extends string = string> = {
  active?: boolean
  disabled?: boolean
  focusableId?: string
  hint?: ReactNode
  onChange?: (value: Value) => void
  options: readonly SelectOption<Value>[]
  value?: Value
}

const DEFAULT_INPUT_ID = "input"

export function SelectInput<Value extends string>(props: SelectInputProps<Value>) {
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
      <SelectInputBody {...props} />
    </Focusable>
  )
}

function SelectInputBody<Value extends string>(props: SelectInputProps<Value>) {
  const theme = useTheme()
  const focused = useIsFocused()
  const highlighted = useIsHighlighted()
  const navigationActive = useIsFocusNavigationActive()
  const active = props.active ?? (navigationActive ? highlighted : focused)
  const inputFocused = focused && !navigationActive
  const interactive = !props.disabled && !!props.onChange && props.options.length > 0
  const backgroundColor = active ? theme.formFieldBackgroundActive : theme.formFieldBackground
  const displayLabel = props.options.find((option) => option.value === props.value)?.label ?? props.value

  useShortcut({
    enabled: inputFocused && interactive,
    keys: { or: ["right", "enter", "return"] },
    onKey(event) {
      event.preventDefault()
      event.stopPropagation()
      cycleOption(1)
    },
  })

  useShortcut({
    enabled: inputFocused && interactive,
    keys: "left",
    onKey(event) {
      event.preventDefault()
      event.stopPropagation()
      cycleOption(-1)
    },
  })

  function cycleOption(step: number) {
    if (!interactive) {
      return
    }

    const currentIndex = props.options.findIndex((option) => option.value === props.value)
    const nextIndex = stepIndex(currentIndex < 0 ? 0 : currentIndex, props.options.length, step)
    const nextValue = props.options[nextIndex]?.value
    if (nextValue !== undefined) {
      props.onChange?.(nextValue)
    }
  }

  return (
    <box alignSelf="stretch" backgroundColor={backgroundColor} flexDirection="row" gap={1} minWidth={0} width="100%">
      <box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        {displayLabel !== undefined
          ? renderSelectOptionLabel(displayLabel, props.disabled ? theme.mutedFg : undefined)
          : null}
      </box>
      {inputFocused && interactive && props.hint ? <Text fg={theme.mutedFg}>{props.hint}</Text> : null}
    </box>
  )
}

function stepIndex(index: number, length: number, step: number): number {
  if (length <= 0) {
    return 0
  }

  return (index + step + length) % length
}
