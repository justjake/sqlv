import { type TextareaRenderable } from "@opentui/core"
import { useCallback, useEffect, useRef, type RefObject } from "react"
import { FocusHalo, FocusNavigable, useIsFocusNavigableFocused } from "../focus"
import { Shortcut } from "../Shortcut"

export type EditorProps = {
  text: string
  onAddConnection?: () => void
  onTextChange?: (sql: string) => void
  onExecute?: (sql: string) => void
  onHistory?: () => void
  autoFocus?: boolean
}

export const QUERY_EDITOR_FOCUS_ID = "query-editor"

export function EditorView(props: EditorProps) {
  const { autoFocus, text, onAddConnection, onTextChange, onExecute, onHistory } = props
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
    <FocusNavigable
      autoFocus={autoFocus}
      flexDirection="column"
      flexGrow={1}
      focus={() => textareaRef.current?.focus()}
      focusNavigableId={QUERY_EDITOR_FOCUS_ID}
    >
      <EditorSurface
        handleClear={handleClear}
        handleContentChange={handleContentChange}
        handleExecute={handleExecute}
        onAddConnection={onAddConnection}
        onHistory={onHistory}
        text={text}
        textareaRef={textareaRef}
      />
    </FocusNavigable>
  )
}

function EditorSurface(props: {
  text: string
  textareaRef: RefObject<TextareaRenderable | null>
  handleContentChange: () => void
  handleExecute: () => void
  handleClear: () => void
  onHistory?: () => void
  onAddConnection?: () => void
}) {
  const focused = useIsFocusNavigableFocused()

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      position="relative"
    >
      <box flexDirection="row" gap={1}>
        <Shortcut keys="ctrl+x" label="Execute" enabled={focused} onKey={props.handleExecute} />
        <Shortcut keys="ctrl+d" label="Clear" enabled={focused} onKey={props.handleClear} />
        <Shortcut keys="ctrl+r" label="History" enabled={focused} onKey={props.onHistory} />
        {props.onAddConnection && <Shortcut keys="ctrl+n" label="Add Conn" enabled={focused} onKey={props.onAddConnection} />}
      </box>
      <textarea
        ref={props.textareaRef}
        focused={focused}
        initialValue={props.text}
        onContentChange={props.handleContentChange}
        onSubmit={props.handleExecute}
      />
      <FocusHalo />
    </box>
  )
}
