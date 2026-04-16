import type { ReactElement, ReactNode } from "react"
import { useIsFocusNavigationActive, useIsFocusWithin } from "../focus/context"
import { useShortcut } from "./keybind/useShortcut"
import { PromptModal } from "./PromptModal"
import { useResolvable, type ResolvableBrand } from "./resolvable"
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

export function ConfirmModal(props: ConfirmModalProps): ReactElement & ResolvableBrand<boolean> {
  const resolvable = useResolvable<boolean>()
  const noAction = resolveConfirmAction(props.no, "no", "n")
  const yesAction = resolveConfirmAction(props.yes, "Yes", "y")
  const onYes = props.onYes ?? resolvable.resolveAs(true)
  const onNo = props.onNo ?? resolvable.resolveAs(false)

  return resolvable(
    <PromptModal
      focusableId={CONFIRM_MODAL_FOCUS_ID}
      footer={
        <>
          <ConfirmModalButton
            defaulted={props.default === "no"}
            hotkeyIndex={noAction.hotkeyIndex}
            label={noAction.label}
            onPress={onNo}
          />
          <ConfirmModalButton
            defaulted={props.default === "yes"}
            hotkeyIndex={yesAction.hotkeyIndex}
            label={yesAction.label}
            onPress={onYes}
          />
        </>
      }
      onClose={onNo}
      title={props.title}
      trapEscLabel={noAction.stringLabel}
    >
      <ConfirmModalBody
        defaultAction={props.default}
        noHotkey={noAction.hotkey}
        onNo={onNo}
        onYes={onYes}
        yesHotkey={yesAction.hotkey}
      >
        {props.children}
      </ConfirmModalBody>
    </PromptModal>,
  ) as ReactElement & ResolvableBrand<boolean>
}

function ConfirmModalBody(props: {
  children: ReactNode
  defaultAction: ConfirmModalProps["default"]
  noHotkey: string
  onNo?: () => void
  onYes?: () => void
  yesHotkey: string
}) {
  const focusedWithin = useIsFocusWithin([CONFIRM_MODAL_FOCUS_ID])
  const navigationActive = useIsFocusNavigationActive()
  const enabled = focusedWithin

  useShortcut({
    enabled: enabled && !!props.onYes,
    keys: { or: [props.yesHotkey, "command+enter", "command+return"] },
    onKey(event) {
      event.preventDefault()
      event.stopPropagation()
      props.onYes?.()
    },
  })

  useShortcut({
    enabled: enabled && !!props.onNo,
    keys: { or: [props.noHotkey, "command+."] },
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
  hotkeyIndex?: number
  label: ReactNode
  onPress?: () => void
}) {
  const theme = useTheme()

  return (
    <box
      alignItems="center"
      backgroundColor={props.defaulted ? theme.focusBg : undefined}
      flexBasis={0}
      flexGrow={1}
      justifyContent="center"
      onMouseUp={props.onPress}
      paddingLeft={1}
      paddingRight={1}
    >
      {renderActionLabel({
        defaulted: props.defaulted,
        hotkeyIndex: props.hotkeyIndex,
        label: props.label,
      })}
    </box>
  )

  function renderActionLabel(input: { defaulted: boolean; hotkeyIndex?: number; label: ReactNode }) {
    if (typeof input.label === "string" || typeof input.label === "number") {
      const text = String(input.label)

      if (input.defaulted) {
        return (
          <Text fg={theme.formFieldLabelActiveFg} wrapMode="none">
            {text}
          </Text>
        )
      }

      if (input.hotkeyIndex !== undefined && input.hotkeyIndex >= 0 && input.hotkeyIndex < text.length) {
        return (
          <Text wrapMode="none">
            {text.slice(0, input.hotkeyIndex)}
            <span fg={theme.focusPrimaryFg}>{text[input.hotkeyIndex]}</span>
            {text.slice(input.hotkeyIndex + 1)}
          </Text>
        )
      }

      return <Text wrapMode="none">{text}</Text>
    }

    return input.label
  }
}

type ConfirmAction = {
  hotkey: string
  hotkeyIndex?: number
  label: ReactNode
  stringLabel: string
}

function resolveConfirmAction(
  value: ReactNode | undefined,
  fallbackLabel: string,
  fallbackHotkey: string,
): ConfirmAction {
  const label = value ?? fallbackLabel
  const stringLabel = typeof label === "string" || typeof label === "number" ? String(label) : fallbackLabel
  const hotkeyMatch = typeof label === "string" || typeof label === "number" ? findHotkeyInText(stringLabel) : undefined

  return {
    hotkey: hotkeyMatch?.key ?? fallbackHotkey,
    hotkeyIndex: hotkeyMatch?.index,
    label,
    stringLabel,
  }
}

function findHotkeyInText(text: string): { index: number; key: string } | undefined {
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char && /[a-z0-9]/i.test(char)) {
      return {
        index,
        key: char.toLowerCase(),
      }
    }
  }

  return undefined
}
