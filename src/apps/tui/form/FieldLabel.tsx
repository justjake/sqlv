import type { ReactNode } from "react"

import { Text } from "../ui/Text"
import { useTheme } from "../ui/theme"

export type FieldLabelProps = {
  active?: boolean
  label: string
  description?: ReactNode
  error?: ReactNode
  children: ReactNode
}

export function FieldLabel(props: FieldLabelProps) {
  const theme = useTheme()
  const active = props.active ?? false
  const ringColor = active ? theme.formFieldFocusRingActive : theme.formFieldFocusRingInactive

  return (
    <box alignSelf="stretch" flexDirection="row">
      <box
        alignSelf="stretch"
        width={1}
        border={["left", "top", "bottom"]}
        borderColor={ringColor}
        borderStyle="rounded"
      />

      <box flexDirection="column" flexGrow={1} minWidth={0} padding={1}>
        <Text fg={active ? theme.formFieldLabelActiveFg : undefined}>{props.label}</Text>
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
  )
}
