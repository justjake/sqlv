import type { ReactNode } from "react"
import type { FocusPath } from "../../lib/focus"
import {
  Focusable,
  useFocusParentPath,
  useFocusedDescendantPath,
  useHighlightedDescendantPath,
  useIsFocusNavigationActive,
  useIsFocusWithin,
  useRememberedDescendantPath,
} from "../focus"
import { useKeybindHandler, useNavKeys } from "../ui/keybind"
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
    down(key) {
      if (!props.down) {
        return
      }

      key.preventDefault()
      key.stopPropagation()
      props.down()
    },
    enabled: inputFocused && !navigationActive && (props.up !== undefined || props.down !== undefined),
    prevent: ["j", "k"],
    up(key) {
      if (!props.up) {
        return
      }

      key.preventDefault()
      key.stopPropagation()
      props.up()
    },
  })

  useKeybindHandler({
    enabled: inputFocused && !navigationActive && (props.up !== undefined || props.down !== undefined),
    detect(event) {
      return event.name === "tab"
    },
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
