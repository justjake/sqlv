import { useMemo, type ReactNode } from "react"
import { Text } from "../ui/Text"
import { useTheme } from "../ui/theme"
import { FormFieldContextProvider } from "./context"

export type FormLabelProps = {
  active?: boolean
  inputFocused?: boolean
  name: string
  description?: ReactNode
  error?: ReactNode
  children: ReactNode
}

export function FormLabel(props: FormLabelProps) {
  const theme = useTheme()
  const active = props.active ?? false
  const inputFocused = props.inputFocused ?? active
  const ringColor = active ? theme.formFieldFocusRingActive : theme.formFieldFocusRingInactive
  const backgroundColor = active ? theme.formFieldBackgroundActive : theme.formFieldBackground

  const ctxValue = useMemo(() => ({ active, inputFocused }), [active, inputFocused])
  return (
    <FormFieldContextProvider value={ctxValue}>
      <box flexDirection="row" flexGrow={1}>
        <box
          alignSelf="stretch"
          width={1}
          border={["left", "top", "bottom"]}
          borderColor={ringColor}
          borderStyle="rounded"
        />

        <box flexDirection="column" flexGrow={1} padding={1}>
          <Text fg={active ? theme.formFieldLabelActiveFg : undefined}>{props.name}</Text>
          {props.description && (
            <Text fg={theme.mutedFg} wrapMode="word">
              {props.description}
            </Text>
          )}
          {props.children}
          {props.error && (
            <Text fg={theme.errorFg} wrapMode="word">
              {props.error}
            </Text>
          )}
        </box>
      </box>
    </FormFieldContextProvider>
  )
}
