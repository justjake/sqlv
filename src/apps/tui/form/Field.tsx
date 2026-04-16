import type { ReactNode } from "react"

import type { FocusPath } from "../../framework/focus/types"
import {
  useFocusParentPath,
  useFocusedDescendantPath,
  useHighlightedDescendantPath,
  useIsFocusNavigationActive,
  useIsFocusWithin,
  useRememberedDescendantPath,
} from "../focus/context"
import { Focusable } from "../focus/Focusable"
import { useNavKeys } from "../ui/keybind/useNavKeys"
import { useShortcut } from "../ui/keybind/useShortcut"

import { FieldLabel } from "./FieldLabel"

export type FieldProps = {
  autoFocus?: boolean
  down?: () => void
  description?: ReactNode
  error?: ReactNode
  focusableId: string
  label: string
  up?: () => void
}

type FormFieldProps = FieldProps & {
  children: (state: { active: boolean }) => ReactNode
}

export function FormField(props: FormFieldProps) {
  const parentPath = useFocusParentPath()

  return (
    <Focusable autoFocus={props.autoFocus} delegatesFocus focusableId={props.focusableId}>
      <FormFieldBody {...props} parentPath={parentPath} />
    </Focusable>
  )
}

function FormFieldBody(props: FormFieldProps & { parentPath: FocusPath }) {
  const focusedDescendantPath = useFocusedDescendantPath()
  const highlightedDescendantPath = useHighlightedDescendantPath()
  const rememberedDescendantPath = useRememberedDescendantPath()
  const navigationActive = useIsFocusNavigationActive()
  const focusWithinParent = useIsFocusWithin(props.parentPath)
  const inputFocused = focusedDescendantPath !== undefined
  const active =
    (navigationActive ? highlightedDescendantPath !== undefined : inputFocused) ||
    (!focusWithinParent && rememberedDescendantPath !== undefined)

  useNavKeys({
    enabled: inputFocused && !navigationActive && (props.up !== undefined || props.down !== undefined),
    handlers: {
      down(key) {
        if (!props.down) {
          return
        }

        key.preventDefault()
        key.stopPropagation()
        props.down()
      },
      up(key) {
        if (!props.up) {
          return
        }

        key.preventDefault()
        key.stopPropagation()
        props.up()
      },
    },
    preventAliases: ["j", "k"],
  })

  useShortcut({
    enabled: inputFocused && !navigationActive && (props.up !== undefined || props.down !== undefined),
    keys: { or: ["tab", "shift+tab"] },
    onKey(event) {
      if (event.shift) {
        if (!props.up) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        props.up()
        return
      }

      if (!props.down) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      props.down()
    },
  })

  return (
    <FieldLabel active={active} description={props.description} error={props.error} label={props.label}>
      {props.children({ active })}
    </FieldLabel>
  )
}
