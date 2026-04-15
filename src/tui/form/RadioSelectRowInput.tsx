import { useEffect, useRef, useState, type ReactNode } from "react"
import { Text } from "../ui/Text"
import { useKeybindHandler } from "../ui/keybind"
import { useTheme } from "../ui/theme"
import { useFormFieldContext } from "./context"

type RadioSelectRowOptionKey = string | number

export type RadioSelectRowOption<Value extends string = string> = {
  key: RadioSelectRowOptionKey
  label: ReactNode
  value: Value
}

export type RadioSelectRowInputProps<Value extends string = string> = {
  hint?: ReactNode
  onChange?: (value: Value) => void
  options: readonly RadioSelectRowOption<Value>[]
  value?: Value
}

export function RadioSelectRowInput<Value extends string>(props: RadioSelectRowInputProps<Value>) {
  const theme = useTheme()
  const { active, inputFocused } = useFormFieldContext()
  const backgroundColor = active ? theme.formFieldBackgroundActive : theme.formFieldBackground
  const [lastSelectedKey, setLastSelectedKey] = useState<RadioSelectRowOptionKey | undefined>(() =>
    resolveSelectedOptionKey(props.options, props.value, undefined) ?? props.options[0]?.key,
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

  useKeybindHandler({
    enabled: inputFocused && !!props.onChange && props.options.length > 0,
    detect(event) {
      return event.name === "left" || event.name === "right" || event.name === "enter" || event.name === "return"
    },
    onKey(event) {
      const step = event.name === "left" ? -1 : 1
      const nextOption = stepRadioSelectOption(props.options, lastSelectedKey, step)
      if (!nextOption || nextOption.key === lastSelectedKey) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setLastSelectedKey(nextOption.key)
      props.onChange?.(nextOption.value)
    },
  })

  function handleSelectOption(option: RadioSelectRowOption<Value>) {
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
              onMouseUp={props.onChange ? () => handleSelectOption(option) : undefined}
            >
              <Text fg={selected ? theme.focusPrimaryFg : theme.mutedFg} wrapMode="none">
                {selected ? "◉" : "○"}
              </Text>
              <box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                {renderOptionLabel(option.label)}
              </box>
            </box>
          )
        })}
      </box>
      {inputFocused && props.hint ? <Text fg={theme.mutedFg}>{props.hint}</Text> : null}
    </box>
  )
}

function resolveSelectedOptionKey<Value extends string>(
  options: readonly RadioSelectRowOption<Value>[],
  value: Value | undefined,
  preferredKey: RadioSelectRowOptionKey | undefined,
): RadioSelectRowOptionKey | undefined {
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
  options: readonly RadioSelectRowOption<Value>[],
  currentKey: RadioSelectRowOptionKey | undefined,
  step: number,
): RadioSelectRowOption<Value> | undefined {
  if (options.length === 0) {
    return undefined
  }

  const currentIndex = options.findIndex((option) => option.key === currentKey)
  if (currentIndex < 0) {
    return options[0]
  }

  return options[(currentIndex + step + options.length) % options.length]
}

function renderOptionLabel(label: ReactNode) {
  if (typeof label === "string" || typeof label === "number") {
    return (
      <Text flexShrink={1} truncate wrapMode="none">
        {label}
      </Text>
    )
  }

  return label
}
