import { type BoxRenderable, type KeyEvent, type LineNumberRenderable, type TextareaRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import {
  getDiagnosticLogicalLine,
  getVisibleEditorAnalysis,
  normalizeHighlightRange,
  selectVisibleSuggestionItems,
  type EditorAnalysisStateSnapshot,
} from "../../lib/editor"
import type {
  RequestEditorAnalysisInput,
  EditorState,
  EditorSuggestionMenuItemFocusInput,
  OpenEditorSuggestionMenuInput,
} from "../../lib/SqlVisor"
import type { SuggestionItem } from "../../lib/suggestions"
import { decideEditorSuggestionMenu } from "../../lib/suggestions/editorCompletion"
import type { SavedQuery } from "../../lib/types/SavedQuery"
import { Focusable, useIsFocused } from "../focus"
import { Shortcut } from "../Shortcut"
import { ensureTreeSitterGrammarLoaded, highlightTreeSitterOnce } from "../tree-sitter/client"
import { Text } from "../ui/Text"
import { useTheme } from "../ui/theme"
import {
  buildEditorSyntaxHighlights,
  createEditorSyntaxStyleRegistry,
  editorCursorLineColors,
  editorInlineAnalysisColors,
  editorLineNumberColors,
  editorTextareaColors,
  EDITOR_SYNTAX_HIGHLIGHT_REF,
  type EditorSyntaxStyleRegistry,
} from "./syntaxHighlighting"

export type EditorProps = {
  editor: EditorState
  analysisConnectionId?: string
  selectedConnectionId?: string
  onEditorChange?: (patch: Partial<Pick<EditorState, "text" | "cursorOffset">>) => void
  onRequestAnalysis?: (input?: RequestEditorAnalysisInput) => void
  onCancelAnalysis?: () => void
  onOpenSuggestionMenu?: (input: OpenEditorSuggestionMenuInput) => void
  onCloseSuggestionMenu?: () => void
  onFocusSuggestionMenuItem?: (input: EditorSuggestionMenuItemFocusInput) => void
  onApplySuggestionMenuItem?: () => void
  onExecute?: (sql: string) => void
  onFormatQuery?: () => void
  onHistory?: () => void
  onSaveAsNew?: () => void
  onSaveChanges?: () => void
  savedQuery?: SavedQuery
  autoFocus?: boolean
}

export const QUERY_EDITOR_FOCUS_ID = "query-editor"

const MENU_MAX_VISIBLE_ITEMS = 8
const MENU_MAX_WIDTH = 60
const MENU_MIN_WIDTH = 18
const EDITOR_DIAGNOSTIC_HIGHLIGHT_REF = 4_201
const EDITOR_EXECUTE_SHORTCUT = { or: ["command+return", "ctrl+return"] } as const
const EDITOR_TEXTAREA_KEY_BINDINGS: Array<{
  action: "newline" | "submit"
  ctrl?: boolean
  meta?: boolean
  name: "linefeed" | "return"
  super?: boolean
}> = [
  { action: "newline", meta: true, name: "return" },
  { action: "submit", ctrl: true, name: "return" },
  { action: "submit", ctrl: true, name: "linefeed" },
  { action: "submit", name: "return", super: true },
  { action: "submit", name: "linefeed", super: true },
]

type EditorAnalysisOverlay = {
  backgroundColor: string
  fg: string
  message: string
  top: number
  width: number
}

export function EditorView(props: EditorProps) {
  const {
    analysisConnectionId,
    autoFocus,
    editor,
    onApplySuggestionMenuItem,
    onCancelAnalysis,
    onCloseSuggestionMenu,
    onEditorChange,
    onExecute,
    onFocusSuggestionMenuItem,
    onFormatQuery,
    onHistory,
    onOpenSuggestionMenu,
    onRequestAnalysis,
    onSaveAsNew,
    onSaveChanges,
    savedQuery,
  } = props
  const textareaRef = useRef<TextareaRenderable>(null)

  const handleExecute = useCallback(() => {
    const text = textareaRef.current?.plainText ?? ""
    if (text.trim()) {
      onExecute?.(text)
    }
  }, [onExecute])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    if (textarea.plainText !== editor.text) {
      textarea.setText(editor.text)
    }

    if (textarea.cursorOffset !== editor.cursorOffset) {
      textarea.cursorOffset = editor.cursorOffset
    }
  }, [editor.cursorOffset, editor.text])

  useEffect(() => {
    if (!onRequestAnalysis && !onCancelAnalysis) {
      return
    }

    if (!editor.text.trim()) {
      onCancelAnalysis?.()
      return
    }

    const timeout = setTimeout(() => {
      onRequestAnalysis?.({
        connectionId: analysisConnectionId,
        text: editor.text,
      })
    }, 180)

    return () => clearTimeout(timeout)
  }, [analysisConnectionId, editor.text, onCancelAnalysis, onRequestAnalysis])

  return (
    <Focusable
      autoFocus={autoFocus}
      focusable
      flexDirection="column"
      flexGrow={1}
      applyFocus={() => textareaRef.current?.focus()}
      focusableId={QUERY_EDITOR_FOCUS_ID}
    >
      <EditorSurface
        editor={editor}
        handleExecute={handleExecute}
        onApplySuggestionMenuItem={onApplySuggestionMenuItem}
        onCloseSuggestionMenu={onCloseSuggestionMenu}
        onEditorChange={onEditorChange}
        onFocusSuggestionMenuItem={onFocusSuggestionMenuItem}
        onFormatQuery={onFormatQuery}
        onHistory={onHistory}
        onOpenSuggestionMenu={onOpenSuggestionMenu}
        onSaveAsNew={onSaveAsNew}
        onSaveChanges={onSaveChanges}
        savedQuery={savedQuery}
        selectedConnectionId={props.selectedConnectionId}
        textareaRef={textareaRef}
      />
    </Focusable>
  )
}

function EditorSurface(props: {
  editor: EditorState
  textareaRef: RefObject<TextareaRenderable | null>
  handleExecute: () => void
  onEditorChange?: (patch: Partial<Pick<EditorState, "text" | "cursorOffset">>) => void
  onOpenSuggestionMenu?: (input: OpenEditorSuggestionMenuInput) => void
  onCloseSuggestionMenu?: () => void
  onFocusSuggestionMenuItem?: (input: EditorSuggestionMenuItemFocusInput) => void
  onApplySuggestionMenuItem?: () => void
  onHistory?: () => void
  onFormatQuery?: () => void
  onSaveAsNew?: () => void
  onSaveChanges?: () => void
  savedQuery?: SavedQuery
  selectedConnectionId?: string
}) {
  const {
    editor,
    handleExecute,
    onApplySuggestionMenuItem,
    onCloseSuggestionMenu,
    onEditorChange,
    onFocusSuggestionMenuItem,
    onFormatQuery,
    onHistory,
    onOpenSuggestionMenu,
    onSaveAsNew,
    onSaveChanges,
    savedQuery,
    selectedConnectionId,
    textareaRef,
  } = props
  const { analysis, cursorOffset, suggestionMenu, text, treeSitterGrammar } = editor
  const focused = useIsFocused()
  const theme = useTheme()
  const renderer = useRenderer()
  const containerRef = useRef<BoxRenderable>(null)
  const lineNumberRef = useRef<LineNumberRenderable>(null)
  const editorSyntaxStylesRef = useRef<EditorSyntaxStyleRegistry | null>(null)
  const syntaxHighlightRequestRef = useRef(0)
  const [, setLayoutVersion] = useState(0)
  const lastObservedEditorStateRef = useRef({
    cursorOffset,
    text,
  })
  const pendingSyncRef = useRef(false)
  const pendingSyncReasonRef = useRef<"content" | "cursor">("cursor")

  const syncEditorState = useCallback(
    (reason: "content" | "cursor") => {
      const textarea = textareaRef.current
      if (!textarea) {
        return
      }

      const text = textarea.plainText
      const cursorOffset = textarea.cursorOffset
      const previousState = lastObservedEditorStateRef.current
      lastObservedEditorStateRef.current = {
        cursorOffset,
        text,
      }
      onEditorChange?.({
        cursorOffset,
        text,
      })

      const suggestionDecision = decideEditorSuggestionMenu({
        cursorOffset,
        menu: suggestionMenu,
        previousText: previousState.text,
        reason,
        selectedConnectionId,
        text,
      })

      if (suggestionDecision.kind === "open") {
        onOpenSuggestionMenu?.(suggestionDecision.input)
        return
      }

      if (suggestionDecision.kind === "close") {
        onCloseSuggestionMenu?.()
      }
    },
    [onCloseSuggestionMenu, onEditorChange, onOpenSuggestionMenu, selectedConnectionId, suggestionMenu, textareaRef],
  )

  const scheduleSyncEditorState = useCallback(
    (reason: "content" | "cursor") => {
      if (reason === "content" || pendingSyncReasonRef.current !== "content") {
        pendingSyncReasonRef.current = reason
      }

      if (pendingSyncRef.current) {
        return
      }

      pendingSyncRef.current = true
      queueMicrotask(() => {
        pendingSyncRef.current = false
        const pendingReason = pendingSyncReasonRef.current
        pendingSyncReasonRef.current = "cursor"
        syncEditorState(pendingReason)
      })
    },
    [syncEditorState],
  )

  const handleClear = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    textarea.clear()
    textarea.cursorOffset = 0
    scheduleSyncEditorState("content")
  }, [scheduleSyncEditorState, textareaRef])

  useEffect(() => {
    lastObservedEditorStateRef.current = {
      cursorOffset,
      text,
    }
  }, [cursorOffset, text])

  useEffect(() => {
    if (!focused || !suggestionMenu.open) {
      return
    }

    const handleKeyPress = (event: KeyEvent) => {
      if (event.ctrl || event.meta || event.option || event.super) {
        return
      }

      switch (event.name) {
        case "up":
          event.preventDefault()
          event.stopPropagation()
          onFocusSuggestionMenuItem?.({ delta: -1 })
          return
        case "down":
          event.preventDefault()
          event.stopPropagation()
          onFocusSuggestionMenuItem?.({ delta: 1 })
          return
        case "enter":
        case "return":
          event.preventDefault()
          event.stopPropagation()
          onApplySuggestionMenuItem?.()
          return
        case "tab":
          if (event.shift) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          onApplySuggestionMenuItem?.()
          return
        case "escape":
          event.preventDefault()
          event.stopPropagation()
          onCloseSuggestionMenu?.()
      }
    }

    renderer.keyInput.prependListener("keypress", handleKeyPress)
    return () => {
      renderer.keyInput.off("keypress", handleKeyPress)
    }
  }, [
    focused,
    onApplySuggestionMenuItem,
    onCloseSuggestionMenu,
    onFocusSuggestionMenuItem,
    renderer,
    suggestionMenu.open,
  ])

  const visibleAnalysis = getVisibleEditorAnalysis(text, analysis)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    const styles = createEditorSyntaxStyleRegistry()

    editorSyntaxStylesRef.current = styles
    textarea.syntaxStyle = styles.syntaxStyle

    return () => {
      if (!textarea.isDestroyed) {
        textarea.removeHighlightsByRef(EDITOR_SYNTAX_HIGHLIGHT_REF)
        textarea.removeHighlightsByRef(EDITOR_DIAGNOSTIC_HIGHLIGHT_REF)
      }
      if (!textarea.isDestroyed && textarea.syntaxStyle === styles.syntaxStyle) {
        textarea.syntaxStyle = null
      }
      if (editorSyntaxStylesRef.current?.syntaxStyle === styles.syntaxStyle) {
        editorSyntaxStylesRef.current = null
      }
      styles.syntaxStyle.destroy()
    }
  }, [textareaRef])

  useEffect(() => {
    const textarea = textareaRef.current
    const styles = editorSyntaxStylesRef.current
    if (!textarea || !styles) {
      return
    }

    if (!treeSitterGrammar || !text.length) {
      textarea.removeHighlightsByRef(EDITOR_SYNTAX_HIGHLIGHT_REF)
      return
    }

    const requestId = ++syntaxHighlightRequestRef.current
    const timeout = setTimeout(() => {
      void (async () => {
        try {
          const hasParser = await ensureTreeSitterGrammarLoaded(treeSitterGrammar)
          if (requestId !== syntaxHighlightRequestRef.current || textarea.isDestroyed) {
            return
          }

          if (!hasParser) {
            textarea.removeHighlightsByRef(EDITOR_SYNTAX_HIGHLIGHT_REF)
            return
          }

          const result = await highlightTreeSitterOnce(text, treeSitterGrammar)
          if (requestId !== syntaxHighlightRequestRef.current || textarea.isDestroyed) {
            return
          }

          textarea.removeHighlightsByRef(EDITOR_SYNTAX_HIGHLIGHT_REF)
          if (result.error || !result.highlights?.length) {
            return
          }

          const syntaxHighlights = buildEditorSyntaxHighlights(text, result.highlights, styles)
          for (const highlight of syntaxHighlights) {
            textarea.addHighlightByCharRange({
              ...highlight,
              hlRef: EDITOR_SYNTAX_HIGHLIGHT_REF,
              priority: 1,
            })
          }
        } catch {
          if (requestId !== syntaxHighlightRequestRef.current || textarea.isDestroyed) {
            return
          }

          textarea.removeHighlightsByRef(EDITOR_SYNTAX_HIGHLIGHT_REF)
        }
      })()
    }, 50)

    return () => {
      clearTimeout(timeout)
    }
  }, [text, textareaRef, treeSitterGrammar])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    applyEditorDiagnosticHighlights(textarea, visibleAnalysis, text, editorSyntaxStylesRef.current)
  }, [text, textareaRef, visibleAnalysis])

  useLayoutEffect(() => {
    if (!textareaRef.current) {
      return
    }

    setLayoutVersion((version) => version + 1)
  }, [textareaRef])

  useEffect(() => {
    const lineNumber = lineNumberRef.current
    const textarea = textareaRef.current
    if (!lineNumber || !textarea || textarea.isDestroyed) {
      return
    }

    lineNumber.clearAllLineColors()
    if (!focused) {
      return
    }

    lineNumber.setLineColor(textarea.logicalCursor.row, {
      content: editorCursorLineColors.contentBackgroundColor,
      gutter: editorCursorLineColors.gutterBackgroundColor,
    })
  }, [cursorOffset, focused, text, textareaRef])

  const flyoutLayout = computeSuggestionMenuLayout(
    suggestionMenu,
    containerRef.current,
    textareaRef.current,
  )
  const analysisOverlay = getEditorAnalysisOverlay(
    visibleAnalysis,
    text,
    textareaRef.current,
    focused,
  )
  const canFormat = !!text.trim()
  const canSave = canFormat

  return (
    <box ref={containerRef} flexDirection="column" flexGrow={1} position="relative">
      <box flexDirection="row" gap={1}>
        <Shortcut keys={EDITOR_EXECUTE_SHORTCUT} label="Execute" enabled={focused} onKey={handleExecute} />
        <Shortcut keys="ctrl+d" label="Clear" enabled={focused} onKey={handleClear} />
        <Shortcut keys="ctrl+r" label="History" enabled={focused} onKey={onHistory} />
        {onFormatQuery && (
          <Shortcut keys="option+f" label="Format" enabled={focused && canFormat} onKey={onFormatQuery} />
        )}
        {onSaveChanges && savedQuery && (
          <Shortcut keys="ctrl+s" label="Save Changes" enabled={focused && canSave} onKey={onSaveChanges} />
        )}
        {onSaveAsNew && (
          <Shortcut
            keys="ctrl+shift+s"
            label={savedQuery ? "Fork" : "Save New"}
            enabled={focused && canSave}
            onKey={onSaveAsNew}
          />
        )}
      </box>
      <box backgroundColor={editorTextareaColors.backgroundColor} flexGrow={1} position="relative">
        <line-number
          ref={lineNumberRef}
          bg={editorLineNumberColors.backgroundColor}
          fg={editorLineNumberColors.textColor}
          height="100%"
          minWidth={3}
          paddingRight={1}
          showLineNumbers
          width="100%"
        >
          <textarea
            backgroundColor={editorTextareaColors.backgroundColor}
            cursorColor={editorTextareaColors.cursorColor}
            focusedBackgroundColor={editorTextareaColors.focusedBackgroundColor}
            flexGrow={1}
            ref={textareaRef}
            focused={focused}
            focusedTextColor={editorTextareaColors.focusedTextColor}
            initialValue={text}
            keyBindings={EDITOR_TEXTAREA_KEY_BINDINGS}
            onContentChange={() => scheduleSyncEditorState("content")}
            onCursorChange={() => scheduleSyncEditorState("cursor")}
            onSubmit={handleExecute}
            placeholderColor={editorTextareaColors.placeholderColor}
            selectionBg={editorTextareaColors.selectionBg}
            selectionFg={editorTextareaColors.selectionFg}
            textColor={editorTextareaColors.textColor}
          />
        </line-number>
        {analysisOverlay && (
          <box
            backgroundColor={analysisOverlay.backgroundColor}
            flexDirection="row"
            height={1}
            paddingLeft={1}
            position="absolute"
            right={0}
            top={analysisOverlay.top}
            zIndex={2}
          >
            <Text fg={analysisOverlay.fg} wrapMode="none">
              {analysisOverlay.message}
            </Text>
          </box>
        )}
      </box>
      {flyoutLayout && (
        <SuggestionMenuFlyout
          focusedItemId={suggestionMenu.focusedItemId}
          items={flyoutLayout.items}
          left={flyoutLayout.left}
          status={suggestionMenu.status}
          top={flyoutLayout.top}
          width={flyoutLayout.width}
          error={suggestionMenu.error}
          theme={theme}
        />
      )}
    </box>
  )
}

function getEditorAnalysisOverlay(
  analysis: EditorAnalysisStateSnapshot,
  text: string,
  textarea: TextareaRenderable | null,
  focused: boolean,
): EditorAnalysisOverlay | undefined {
  switch (analysis.status) {
    case "idle":
      return undefined
    case "loading":
      return undefined
    case "error":
      return createEditorAnalysisOverlay({
        backgroundColor: editorTextareaColors.backgroundColor,
        fg: editorInlineAnalysisColors.errorTextColor,
        message: analysis.error ?? "Explain failed.",
        preferredTop: 0,
        textarea,
      })
    case "ready": {
      const result = analysis.result
      if (!result || result.status === "unsupported" || result.status === "ok") {
        return undefined
      }

      const diagnostic = result.diagnostics[0]
      const extraCount = Math.max(0, result.diagnostics.length - 1)
      const logicalLine = getDiagnosticLogicalLine(text, diagnostic?.range)
      const preferredTop = logicalLine === undefined ? 0 : getVisibleLogicalLineTop(textarea, logicalLine)
      const backgroundColor =
        focused && logicalLine !== undefined && textarea && logicalLine === textarea.logicalCursor.row
          ? editorCursorLineColors.contentBackgroundColor
          : editorTextareaColors.backgroundColor

      return createEditorAnalysisOverlay({
        backgroundColor,
        fg: editorInlineAnalysisColors.textColor,
        message: `${diagnostic?.message ?? "Invalid query."}${extraCount > 0 ? ` (+${extraCount} more)` : ""}`,
        preferredTop,
        textarea,
        targetLogicalLine: logicalLine,
      })
    }
  }
}

function createEditorAnalysisOverlay(options: {
  backgroundColor: string
  fg: string
  message: string
  preferredTop: number | undefined
  textarea: TextareaRenderable | null
  targetLogicalLine?: number
}): EditorAnalysisOverlay | undefined {
  const { backgroundColor, fg, message, preferredTop, targetLogicalLine, textarea } = options
  if (!textarea || textarea.isDestroyed || !message.length) {
    return undefined
  }

  const textareaWidth = textarea.width > 0 ? textarea.width : 48
  const width = measureAnalysisOverlayWidth(textareaWidth, message)
  if (targetLogicalLine !== undefined && preferredTop !== undefined && textarea.width > 0) {
    const visualLineIndex = textarea.scrollY + preferredTop
    const lineWidth = textarea.lineInfo.lineWidthCols[visualLineIndex] ?? 0
    const availableWidth = Math.max(0, textareaWidth - lineWidth - 1)
    if (availableWidth >= width) {
      return {
        backgroundColor,
        fg,
        message,
        top: preferredTop,
        width,
      }
    }
  }

  return {
    backgroundColor,
    fg,
    message,
    top: 0,
    width,
  }
}

function measureAnalysisOverlayWidth(textareaWidth: number, message: string): number {
  return clampValue(message.length + 2, 18, Math.max(18, Math.floor(textareaWidth * 0.5)))
}

function getVisibleLogicalLineTop(textarea: TextareaRenderable | null, logicalLine: number): number | undefined {
  if (!textarea) {
    return undefined
  }

  const lineSources = textarea.lineInfo.lineSources
  const firstVisibleLine = textarea.scrollY
  const lastVisibleLine = Math.min(lineSources.length, firstVisibleLine + textarea.height)

  for (let visualLineIndex = firstVisibleLine; visualLineIndex < lastVisibleLine; visualLineIndex += 1) {
    if (lineSources[visualLineIndex] === logicalLine) {
      return visualLineIndex - firstVisibleLine
    }
  }

  return undefined
}

function applyEditorDiagnosticHighlights(
  textarea: TextareaRenderable,
  analysis: EditorAnalysisStateSnapshot,
  text: string,
  styles: EditorSyntaxStyleRegistry | null,
): void {
  if (textarea.isDestroyed) {
    return
  }
  textarea.removeHighlightsByRef(EDITOR_DIAGNOSTIC_HIGHLIGHT_REF)
  if (!styles || analysis.status !== "ready" || analysis.result?.status !== "invalid") {
    return
  }

  for (const diagnostic of analysis.result.diagnostics) {
    const range = normalizeHighlightRange(text, diagnostic.range)
    if (!range) {
      continue
    }

    textarea.addHighlightByCharRange({
      end: range.end,
      hlRef: EDITOR_DIAGNOSTIC_HIGHLIGHT_REF,
      priority: 20,
      start: range.start,
      styleId: getDiagnosticStyleId(styles, diagnostic.severity),
    })
  }
}

function getDiagnosticStyleId(styles: EditorSyntaxStyleRegistry, severity: "error" | "warning" | "info"): number {
  switch (severity) {
    case "warning":
      return styles.warningStyleId
    case "info":
      return styles.infoStyleId
    default:
      return styles.errorStyleId
  }
}

function SuggestionMenuFlyout(props: {
  items: SuggestionItem[]
  focusedItemId: string | undefined
  status: EditorState["suggestionMenu"]["status"]
  error: string | undefined
  left: number
  top: number
  width: number
  theme: ReturnType<typeof useTheme>
}) {
  const statusMessage = getSuggestionMenuStatusMessage(props.status, props.error, props.items.length)

  return (
    <box
      backgroundColor={props.theme.inputBg}
      border={["top", "right", "bottom", "left"]}
      borderColor={props.theme.borderColor}
      borderStyle="single"
      flexDirection="column"
      left={props.left}
      position="absolute"
      top={props.top}
      width={props.width}
      zIndex={4}
    >
      {statusMessage && (
        <box flexDirection="row" paddingLeft={1} paddingRight={1}>
          <Text fg={props.theme.mutedFg}>{statusMessage}</Text>
        </box>
      )}
      {!statusMessage &&
        props.items.map((item) => (
          <box
            key={item.id}
            backgroundColor={item.id === props.focusedItemId ? props.theme.focusBg : undefined}
            flexDirection="row"
            paddingLeft={1}
            paddingRight={1}
          >
            <Text flexShrink={1}>{item.label}</Text>
            {item.kind && <Text fg={props.theme.mutedFg}>{` ${item.kind}`}</Text>}
            {item.detail && <Text fg={props.theme.mutedFg}>{` | ${item.detail}`}</Text>}
          </box>
        ))}
    </box>
  )
}

function computeSuggestionMenuLayout(
  menu: EditorState["suggestionMenu"],
  container: BoxRenderable | null,
  textarea: TextareaRenderable | null,
): { items: SuggestionItem[]; left: number; top: number; width: number } | undefined {
  if (!menu.open || !container || !textarea || container.width <= 0 || container.height <= 0) {
    return undefined
  }

  const maxVisibleItems = Math.max(1, Math.min(MENU_MAX_VISIBLE_ITEMS, container.height - 2))
  const items = selectVisibleSuggestionItems(menu.items, menu.focusedItemId, maxVisibleItems)
  const statusMessage = getSuggestionMenuStatusMessage(menu.status, menu.error, menu.items.length)
  const width = measureSuggestionMenuWidth(items, statusMessage, container.width)
  const bodyRows = statusMessage ? 1 : Math.max(1, items.length)
  const totalHeight = bodyRows + 2
  const cursorX = textarea.x + textarea.visualCursor.visualCol
  const cursorY = textarea.y + textarea.visualCursor.visualRow
  const preferredLeft = cursorX - container.x
  const belowTop = cursorY - container.y + 1
  const aboveTop = cursorY - container.y - totalHeight

  return {
    items,
    left: clampValue(preferredLeft, 0, Math.max(0, container.width - width)),
    top: belowTop + totalHeight <= container.height ? belowTop : Math.max(0, aboveTop),
    width,
  }
}

function measureSuggestionMenuWidth(
  items: SuggestionItem[],
  statusMessage: string | undefined,
  containerWidth: number,
): number {
  const itemWidth = items.reduce((current, item) => {
    const detail = item.detail ? ` | ${item.detail}` : ""
    const kind = item.kind ? ` ${item.kind}` : ""
    return Math.max(current, item.label.length + kind.length + detail.length + 2)
  }, 0)
  const width = Math.max(itemWidth, (statusMessage?.length ?? 0) + 2)
  return clampValue(width, MENU_MIN_WIDTH, Math.min(MENU_MAX_WIDTH, containerWidth))
}

function getSuggestionMenuStatusMessage(
  status: EditorState["suggestionMenu"]["status"],
  error: string | undefined,
  itemCount: number,
): string | undefined {
  switch (status) {
    case "loading":
      return "Searching..."
    case "error":
      return error ?? "Suggestions failed."
    case "ready":
      return itemCount === 0 ? "No suggestions." : undefined
    default:
      return undefined
  }
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
