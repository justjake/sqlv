import { type TextareaRenderable } from "@opentui/core"
import { useCallback, useEffect, useRef } from "react"
import { Shortcut } from "../Shortcut"

export type EditorProps = {
  focused?: boolean
  text: string
  onAddConnection?: () => void
  onTextChange?: (sql: string) => void
  onExecute?: (sql: string) => void
  onHistory?: () => void
}

export function EditorView(props: EditorProps) {
  const { focused, text, onAddConnection, onTextChange, onExecute, onHistory } = props
  const textareaRef = useRef<TextareaRenderable>(null)

  const handleExecute = useCallback(() => {
    const text = textareaRef.current?.plainText ?? ""
    if (text.trim()) {
      onExecute?.(text)
    }
  }, [onExecute])

  const handleClear = useCallback(() => {
    textareaRef.current?.clear()
    onTextChange?.("")
  }, [onTextChange])

  const handleContentChange = useCallback(() => {
    onTextChange?.(textareaRef.current?.plainText ?? "")
  }, [onTextChange])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    if (textarea.plainText === text) {
      return
    }

    textarea.setText(text)
    textarea.cursorOffset = text.length
  }, [text])

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" gap={1}>
        <Shortcut label="Execute" ctrl name="x" enabled={focused} onKey={handleExecute} />
        <Shortcut label="Clear" ctrl name="d" enabled={focused} onKey={handleClear} />
        <Shortcut label="History" ctrl name="r" enabled={focused} onKey={onHistory} />
        {onAddConnection && <Shortcut label="Add Conn" ctrl name="n" enabled={focused} onKey={onAddConnection} />}
      </box>
      <textarea
        ref={textareaRef}
        focused={focused}
        initialValue={text}
        onContentChange={handleContentChange}
        onSubmit={handleExecute}
      />
    </box>
  )
}
