import type { InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useEffect, useRef, useState } from "react"
import { FocusHalo, Focusable, useIsFocusWithin } from "../focus"
import { Shortcut } from "../Shortcut"
import { useTheme } from "../ui/theme"

export const SAVE_QUERY_DIALOG_FOCUS_ID = "save-query-dialog"

export type SaveQueryDialogProps = {
  initialName?: string
  mode: "create" | "fork"
  saving?: boolean
  error?: string
  onCancel: () => void
  onSave: (name: string) => void | Promise<void>
}

export function SaveQueryDialog(props: SaveQueryDialogProps) {
  const { error, initialName, mode, onCancel, onSave, saving } = props
  const inputRef = useRef<InputRenderable>(null)
  const theme = useTheme()
  const [name, setName] = useState(initialName ?? "")
  const focusedWithin = useIsFocusWithin([SAVE_QUERY_DIALOG_FOCUS_ID])
  const title = mode === "fork" ? "Fork Saved Query" : "Save Query"
  const saveEnabled = !saving && !!name.trim()

  useEffect(() => {
    setName(initialName ?? "")
  }, [initialName])

  useKeyboard((event) => {
    if (!focusedWithin || saving) {
      return
    }

    switch (event.name) {
      case "enter":
      case "return":
        if (!name.trim()) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        void onSave(name)
        return
      case "escape":
        event.preventDefault()
        event.stopPropagation()
        onCancel()
    }
  })

  return (
    <Focusable
      autoFocus
      applyFocus={() => inputRef.current?.focus()}
      childrenNavigable={false}
      delegatesFocus
      focusable
      focusableId={SAVE_QUERY_DIALOG_FOCUS_ID}
      onTrapEsc={onCancel}
      trap
      trapEscLabel="Cancel"
    >
      <box
        backgroundColor={theme.inputBg}
        border={["top", "right", "bottom", "left"]}
        borderColor={theme.borderColor}
        borderStyle="single"
        flexDirection="column"
        gap={1}
        paddingBottom={1}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        position="relative"
        width="100%"
      >
        <box flexDirection="row" gap={1}>
          <Shortcut keys="enter" label="Save" enabled={saveEnabled} onKey={() => void onSave(name)} />
          <Shortcut keys="escape" label="Cancel" enabled={!saving} onKey={onCancel} />
        </box>
        <text>{title}</text>
        <box flexDirection="row">
          <text>Name </text>
          <box backgroundColor={focusedWithin ? theme.focusBg : theme.shortcutBg} flexGrow={1}>
            <input
              ref={inputRef}
              focused={focusedWithin}
              flexGrow={1}
              onInput={setName}
              placeholder="Query name"
              value={name}
            />
          </box>
        </box>
        {error && <text fg={theme.errorFg}>{error}</text>}
        <FocusHalo />
      </box>
    </Focusable>
  )
}
