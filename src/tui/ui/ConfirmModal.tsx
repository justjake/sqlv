import type { ReactNode } from "react"
import { useIsFocusNavigationActive, useIsFocusWithin } from "../focus"
import { useShortcut } from "./keybind"
import { PromptModal } from "./PromptModal"
import { useResolvable } from "./resolvable"
import { Text } from "./Text"
import { useTheme } from "./theme"

export const CONFIRM_MODAL_FOCUS_ID = "confirm-modal"

export type ConfirmModalProps = {
  children: ReactNode
  default?: "yes" | "no"
  no?: ReactNode
  onNo?: () => void
  onYes?: () => void
  title?: ReactNode
  yes?: ReactNode
}

export function ConfirmModal(props: ConfirmModalProps) {
  const resolvable = useResolvable<boolean>()
  const onYes = props.onYes ?? resolvable.resolveAs(true)
  const onNo = props.onNo ?? resolvable.resolveAs(false)

  return resolvable(
    <PromptModal
      focusableId={CONFIRM_MODAL_FOCUS_ID}
      footer={
        <>
          <ConfirmModalButton defaulted={props.default === "no"} hotkey="n" label={props.no ?? "no"} onPress={onNo} />
          <ConfirmModalButton
            defaulted={props.default === "yes"}
            hotkey="y"
            label={props.yes ?? "Yes"}
            onPress={onYes}
          />
        </>
      }
      onClose={onNo}
      title={props.title}
      trapEscLabel={stringLabel(props.no, "No")}
    >
      <ConfirmModalBody defaultAction={props.default} onNo={onNo} onYes={onYes}>
        {props.children}
      </ConfirmModalBody>
    </PromptModal>,
  )
}

function ConfirmModalBody(props: {
  children: ReactNode
  defaultAction: ConfirmModalProps["default"]
  onNo?: () => void
  onYes?: () => void
}) {
  const focusedWithin = useIsFocusWithin([CONFIRM_MODAL_FOCUS_ID])
  const navigationActive = useIsFocusNavigationActive()
  const enabled = focusedWithin

  useShortcut({
    enabled: enabled && !!props.onYes,
    keys: { or: ["y", "command+enter", "command+return"] },
    onKey(event) {
      event.preventDefault()
      event.stopPropagation()
      props.onYes?.()
    },
  })

  useShortcut({
    enabled: enabled && !!props.onNo,
    keys: { or: ["n", "command+."] },
    onKey(event) {
      event.preventDefault()
      event.stopPropagation()
      props.onNo?.()
    },
  })

  useShortcut({
    enabled: enabled && !navigationActive && props.defaultAction === "yes" && !!props.onYes,
    keys: { or: ["enter", "return"] },
    onKey(event) {
      event.preventDefault()
      event.stopPropagation()
      props.onYes?.()
    },
  })

  useShortcut({
    enabled: enabled && !navigationActive && props.defaultAction === "no" && !!props.onNo,
    keys: { or: ["enter", "return"] },
    onKey(event) {
      event.preventDefault()
      event.stopPropagation()
      props.onNo?.()
    },
  })

  useShortcut({
    enabled: enabled && !navigationActive && !!props.onNo,
    keys: "esc",
    onKey(event) {
      event.preventDefault()
      event.stopPropagation()
      props.onNo?.()
    },
  })

  if (typeof props.children === "string" || typeof props.children === "number") {
    return <Text wrapMode="word">{props.children}</Text>
  }

  return props.children
}

function ConfirmModalButton(props: {
  defaulted: boolean
  hotkey: "n" | "y"
  label: ReactNode
  onPress?: () => void
}) {
  const theme = useTheme()

  return (
    <box
      backgroundColor={props.defaulted ? theme.focusBg : undefined}
      border
      borderColor={props.defaulted ? theme.focusBg : theme.borderColor}
      borderStyle="single"
      onMouseUp={props.onPress}
      paddingLeft={2}
      paddingRight={2}
    >
      {renderActionLabel({
        defaulted: props.defaulted,
        hotkey: props.hotkey,
        label: props.label,
      })}
    </box>
  )

  function renderActionLabel(input: { defaulted: boolean; hotkey: "n" | "y"; label: ReactNode }) {
    if (typeof input.label === "string" || typeof input.label === "number") {
      const text = String(input.label)

      if (input.defaulted) {
        return (
          <Text fg={theme.formFieldLabelActiveFg} wrapMode="none">
            {text}
          </Text>
        )
      }

      if (text[0]?.toLowerCase() === input.hotkey) {
        return (
          <Text wrapMode="none">
            <span fg={theme.focusPrimaryFg}>{text[0]}</span>
            {text.slice(1)}
          </Text>
        )
      }

      return <Text wrapMode="none">{text}</Text>
    }

    return input.label
  }
}

function stringLabel(value: ReactNode | undefined, fallback: string) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value)
  }

  return fallback
}
