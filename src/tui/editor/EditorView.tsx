import { type TextareaRenderable } from "@opentui/core"
import { useCallback, useRef } from "react"
import { Shortcut } from "../Shortcut"

export type EditorProps = {
  focused?: boolean
  initialText?: string
  onExecute?: (sql: string) => void
  onHistory?: () => void
}

export function EditorView(props: EditorProps) {
  const { focused, initialText, onExecute, onHistory } = props
  const textareaRef = useRef<TextareaRenderable>(null)

  const handleExecute = useCallback(() => {
    const text = textareaRef.current?.plainText ?? ""
    if (text.trim()) {
      onExecute?.(text)
    }
  }, [onExecute])

  const handleClear = useCallback(() => {
    textareaRef.current?.clear()
  }, [])

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" gap={1}>
        <Shortcut label="Execute" ctrl name="x" enabled={focused} onKey={handleExecute} />
        <Shortcut label="Clear" ctrl name="d" enabled={focused} onKey={handleClear} />
        <Shortcut label="History" ctrl name="r" enabled={focused} onKey={onHistory} />
      </box>
      <textarea ref={textareaRef} focused={focused} initialValue={initialText ?? ""} />
    </box>
  )
}
