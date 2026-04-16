import { useEffect, useRef, useState, type ReactNode } from "react"
import { Focusable } from "../focus/Focusable"
import { useIsFocusNavigationActive, useIsFocused, useIsHighlighted } from "../focus/context"
import { Text } from "../ui/Text"
import { useShortcut } from "../ui/keybind/useShortcut"
import { useTheme } from "../ui/theme"
import { renderSelectOptionLabel } from "./selectOptionLabel"

type SelectOptionRowOptionKey = string | number

export type SelectOptionRowOption<Value extends string = string> = {
  key: SelectOptionRowOptionKey
  label: ReactNode
  value: Value
}

export type SelectOptionRowInputProps<Value extends string = string> = {
  active?: boolean
  disabled?: boolean
  focusableId?: string
  hint?: ReactNode
  onChange?: (value: Value) => void
  options: readonly SelectOptionRowOption<Value>[]
  value?: Value
}

const DEFAULT_INPUT_ID = "input"

export function SelectOptionRowInput<Value extends string>(props: SelectOptionRowInputProps<Value>) {
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
      <SelectOptionRowInputBody {...props} />
    </Focusable>
  )
}

function SelectOptionRowInputBody<Value extends string>(props: SelectOptionRowInputProps<Value>) {
  const theme = useTheme()
  const focused = useIsFocused()
  const highlighted = useIsHighlighted()
  const navigationActive = useIsFocusNavigationActive()
  const active = props.active ?? (navigationActive ? highlighted : focused)
  const inputFocused = focused && !navigationActive
  const backgroundColor = active ? theme.formFieldBackgroundActive : theme.formFieldBackground
  const interactive = !props.disabled && !!props.onChange && props.options.length > 0
  const [lastSelectedKey, setLastSelectedKey] = useState<SelectOptionRowOptionKey | undefined>(
    () => resolveSelectedOptionKey(props.options, props.value, undefined) ?? props.options[0]?.key,
  )
  const selectedOptionKey = resolveSelectedOptionKey(props.options, props.value, lastSelectedKey)
  const previousValueRef = useRef(props.value)

  useEffect(() => {
    if (props.value === previousValueRef.current) {
      return
    }

    previousValueRef.current = props.value
    const nextSelectedKey = resolveSelectedOptionKey(props.options, props.value, lastSelectedKey)
    if (nextSelectedKey !== undefined && nextSelectedKey !== lastSelectedKey) {
      setLastSelectedKey(nextSelectedKey)
    }
  }, [lastSelectedKey, props.options, props.value])

  useEffect(() => {
    if (props.options.length === 0) {
      if (lastSelectedKey !== undefined) {
        setLastSelectedKey(undefined)
      }
      return
    }

    if (props.options.some((option) => option.key === lastSelectedKey)) {
      return
    }

    const firstKey = props.options[0]?.key
    if (firstKey !== undefined && firstKey !== lastSelectedKey) {
      setLastSelectedKey(firstKey)
    }
  }, [lastSelectedKey, props.options])

  useShortcut({
    enabled: inputFocused && interactive,
    keys: { or: ["right", "enter", "return"] },
    onKey(event) {
      const nextOption = stepRadioSelectOption(props.options, lastSelectedKey, 1)
      if (!nextOption || nextOption.key === lastSelectedKey) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setLastSelectedKey(nextOption.key)
      props.onChange?.(nextOption.value)
    },
  })

  useShortcut({
    enabled: inputFocused && interactive,
    keys: "left",
    onKey(event) {
      const nextOption = stepRadioSelectOption(props.options, lastSelectedKey, -1)
      if (!nextOption || nextOption.key === lastSelectedKey) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setLastSelectedKey(nextOption.key)
      props.onChange?.(nextOption.value)
    },
  })

  function handleSelectOption(option: SelectOptionRowOption<Value>) {
    setLastSelectedKey(option.key)
    props.onChange?.(option.value)
  }

  return (
    <box alignSelf="stretch" backgroundColor={backgroundColor} flexDirection="row" gap={1} minWidth={0} width="100%">
      <box flexDirection="row" flexGrow={1} flexShrink={1} gap={1} minWidth={0}>
        {props.options.map((option) => {
          const selected = option.key === selectedOptionKey

          return (
            <box
              alignItems="flex-start"
              key={option.key}
              flexBasis={0}
              flexDirection="row"
              flexGrow={1}
              flexShrink={1}
              gap={1}
              minWidth={0}
              onMouseUp={interactive ? () => handleSelectOption(option) : undefined}
            >
              <Text
                fg={props.disabled ? theme.mutedFg : selected ? theme.focusPrimaryFg : theme.mutedFg}
                wrapMode="none"
              >
                {selected ? "◉" : "○"}
              </Text>
              <box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                {renderSelectOptionLabel(option.label, props.disabled ? theme.mutedFg : undefined)}
              </box>
            </box>
          )
        })}
      </box>
      {inputFocused && interactive && props.hint ? <Text fg={theme.mutedFg}>{props.hint}</Text> : null}
    </box>
  )
}

function resolveSelectedOptionKey<Value extends string>(
  options: readonly SelectOptionRowOption<Value>[],
  value: Value | undefined,
  preferredKey: SelectOptionRowOptionKey | undefined,
): SelectOptionRowOptionKey | undefined {
  if (value === undefined) {
    return undefined
  }

  const keyedMatch = options.find((option) => option.key === preferredKey && option.value === value)
  if (keyedMatch) {
    return keyedMatch.key
  }

  return options.find((option) => option.value === value)?.key
}

function stepRadioSelectOption<Value extends string>(
  options: readonly SelectOptionRowOption<Value>[],
  currentKey: SelectOptionRowOptionKey | undefined,
  step: number,
): SelectOptionRowOption<Value> | undefined {
  if (options.length === 0) {
    return undefined
  }

  const currentIndex = options.findIndex((option) => option.key === currentKey)
  if (currentIndex < 0) {
    return options[0]
  }

  return options[(currentIndex + step + options.length) % options.length]
}
