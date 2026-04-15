import type { InputRenderable } from "@opentui/core"
import { useEffect, useRef, useState } from "react"
import { FocusHalo, Focusable, useIsFocusWithin } from "../focus"
import { Shortcut } from "../Shortcut"
import { useKeybindHandler } from "../ui/keybind"
import { Text } from "../ui/Text"
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

  useKeybindHandler({
    enabled: focusedWithin && !saving,
    onKey(event) {
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
    },
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
        alignSelf="stretch"
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
      >
        <box flexDirection="row" gap={1}>
          <Shortcut keys="return" label="Save" enabled={saveEnabled} onKey={() => void onSave(name)} />
          <Shortcut keys="esc" label="Cancel" enabled={!saving} onKey={onCancel} />
        </box>
        <Text>{title}</Text>
        <box flexDirection="row">
          <Text>Name </Text>
          <box backgroundColor={focusedWithin ? theme.focusBg : theme.shortcutBg} flexGrow={1}>
            <input
              cursorColor={theme.primaryFg}
              ref={inputRef}
              focused={focusedWithin}
              focusedTextColor={theme.primaryFg}
              flexGrow={1}
              onInput={setName}
              placeholder="Query name"
              placeholderColor={theme.mutedFg}
              textColor={theme.primaryFg}
              value={name}
            />
          </box>
        </box>
        {error && <Text fg={theme.errorFg}>{error}</Text>}
        <FocusHalo />
      </box>
    </Focusable>
  )
}
