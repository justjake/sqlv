import { SyntaxStyle, type BoxRenderable, type KeyEvent, type TextareaRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useCallback, useEffect, useRef, type RefObject } from "react"
import type {
  RequestEditorAnalysisInput,
  EditorState,
  EditorSuggestionMenuItemFocusInput,
  OpenEditorSuggestionMenuInput,
} from "../../lib/SqlVisor"
import type { EditorRange, SuggestionItem } from "../../lib/suggestions"
import type { SavedQuery } from "../../lib/types/SavedQuery"
import { FocusHalo, Focusable, useIsFocused } from "../focus"
import { Shortcut } from "../Shortcut"
import { useTheme } from "../ui/theme"

export type EditorProps = {
  editor: EditorState
  analysisConnectionId?: string
  onEditorChange?: (patch: Partial<Pick<EditorState, "text" | "cursorOffset">>) => void
  onRequestAnalysis?: (input?: RequestEditorAnalysisInput) => void
  onCancelAnalysis?: () => void
  onOpenSuggestionMenu?: (input: OpenEditorSuggestionMenuInput) => void
  onCloseSuggestionMenu?: () => void
  onFocusSuggestionMenuItem?: (input: EditorSuggestionMenuItemFocusInput) => void
  onApplySuggestionMenuItem?: () => void
  onAddConnection?: () => void
  onExecute?: (sql: string) => void
  onHistory?: () => void
  onSaveAsNew?: () => void
  onSaveChanges?: () => void
  savedQuery?: SavedQuery
  autoFocus?: boolean
}

export type MentionSuggestionTrigger = {
  query: string
  replacementRange: EditorRange
}

export const QUERY_EDITOR_FOCUS_ID = "query-editor"

const MENU_MAX_VISIBLE_ITEMS = 8
const MENU_MAX_WIDTH = 60
const MENU_MIN_WIDTH = 18
const EDITOR_DIAGNOSTIC_HIGHLIGHT_REF = 4_201

type DiagnosticStyleRegistry = {
  errorStyleId: number
  infoStyleId: number
  syntaxStyle: SyntaxStyle
  warningStyleId: number
}

type SyntaxColor = NonNullable<Parameters<SyntaxStyle["registerStyle"]>[1]["fg"]>

type EditorAnalysisBanner = {
  borderColor: string
  detail?: string
  detailFg: string
  location?: string
  title: string
  titleFg: string
}

export function EditorView(props: EditorProps) {
  const { analysisConnectionId, autoFocus, editor, onAddConnection, onApplySuggestionMenuItem, onCancelAnalysis, onCloseSuggestionMenu, onEditorChange, onExecute, onFocusSuggestionMenuItem, onHistory, onOpenSuggestionMenu, onRequestAnalysis, onSaveAsNew, onSaveChanges, savedQuery } = props
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
        onAddConnection={onAddConnection}
        onApplySuggestionMenuItem={onApplySuggestionMenuItem}
        onCloseSuggestionMenu={onCloseSuggestionMenu}
        onEditorChange={onEditorChange}
        onFocusSuggestionMenuItem={onFocusSuggestionMenuItem}
        onHistory={onHistory}
        onOpenSuggestionMenu={onOpenSuggestionMenu}
        onSaveAsNew={onSaveAsNew}
        onSaveChanges={onSaveChanges}
        savedQuery={savedQuery}
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
  onAddConnection?: () => void
  onSaveAsNew?: () => void
  onSaveChanges?: () => void
  savedQuery?: SavedQuery
}) {
  const focused = useIsFocused()
  const theme = useTheme()
  const renderer = useRenderer()
  const containerRef = useRef<BoxRenderable>(null)
  const diagnosticStylesRef = useRef<DiagnosticStyleRegistry | null>(null)
  const lastObservedEditorStateRef = useRef({
    cursorOffset: props.editor.cursorOffset,
    text: props.editor.text,
  })
  const pendingSyncRef = useRef(false)
  const pendingSyncReasonRef = useRef<"content" | "cursor">("cursor")

  const syncEditorState = useCallback((reason: "content" | "cursor") => {
    const textarea = props.textareaRef.current
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
    props.onEditorChange?.({
      cursorOffset,
      text,
    })

    const mentionTrigger = detectMentionSuggestionTrigger(text, cursorOffset)
    const hasOpenMentionMenu = props.editor.suggestionMenu.open && props.editor.suggestionMenu.trigger?.kind === "mention"
    if (mentionTrigger) {
      const shouldRefreshOpenMentionMenu =
        hasOpenMentionMenu &&
        (
          reason === "content" ||
          props.editor.suggestionMenu.query !== mentionTrigger.query ||
          !rangesEqual(props.editor.suggestionMenu.replacementRange, mentionTrigger.replacementRange)
        )
      const shouldOpenFromTriggerInsertion =
        !hasOpenMentionMenu &&
        reason === "content" &&
        didInsertMentionTrigger(previousState.text, text, mentionTrigger.replacementRange)

      if (shouldRefreshOpenMentionMenu || shouldOpenFromTriggerInsertion) {
        props.onOpenSuggestionMenu?.({
          cursorOffset,
          documentText: text,
          replacementRange: mentionTrigger.replacementRange,
          trigger: {
            context: {
              triggerText: "@",
            },
            kind: "mention",
            query: mentionTrigger.query,
          },
        })
      }
      return
    }

    if (hasOpenMentionMenu) {
      props.onCloseSuggestionMenu?.()
    }
  }, [
    props.editor.suggestionMenu.open,
    props.editor.suggestionMenu.query,
    props.editor.suggestionMenu.replacementRange,
    props.editor.suggestionMenu.trigger,
    props.onCloseSuggestionMenu,
    props.onEditorChange,
    props.onOpenSuggestionMenu,
    props.textareaRef,
  ])

  const scheduleSyncEditorState = useCallback((reason: "content" | "cursor") => {
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
  }, [syncEditorState])

  const handleClear = useCallback(() => {
    const textarea = props.textareaRef.current
    if (!textarea) {
      return
    }
    textarea.clear()
    textarea.cursorOffset = 0
    scheduleSyncEditorState("content")
  }, [props.textareaRef, scheduleSyncEditorState])

  useEffect(() => {
    lastObservedEditorStateRef.current = {
      cursorOffset: props.editor.cursorOffset,
      text: props.editor.text,
    }
  }, [props.editor.cursorOffset, props.editor.text])

  useEffect(() => {
    if (!focused || !props.editor.suggestionMenu.open) {
      return
    }

    const handleKeyPress = (event: KeyEvent) => {
      if (event.ctrl || event.meta || event.option) {
        return
      }

      switch (event.name) {
        case "up":
          event.preventDefault()
          event.stopPropagation()
          props.onFocusSuggestionMenuItem?.({ delta: -1 })
          return
        case "down":
          event.preventDefault()
          event.stopPropagation()
          props.onFocusSuggestionMenuItem?.({ delta: 1 })
          return
        case "enter":
        case "return":
          event.preventDefault()
          event.stopPropagation()
          props.onApplySuggestionMenuItem?.()
          return
        case "tab":
          if (event.shift) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          props.onApplySuggestionMenuItem?.()
          return
        case "escape":
          event.preventDefault()
          event.stopPropagation()
          props.onCloseSuggestionMenu?.()
      }
    }

    renderer.keyInput.prependListener("keypress", handleKeyPress)
    return () => {
      renderer.keyInput.off("keypress", handleKeyPress)
    }
  }, [
    focused,
    props.editor.suggestionMenu.open,
    props.onApplySuggestionMenuItem,
    props.onCloseSuggestionMenu,
    props.onFocusSuggestionMenuItem,
    renderer,
  ])

  const visibleAnalysis = getVisibleEditorAnalysis(props.editor)

  useEffect(() => {
    const textarea = props.textareaRef.current
    if (!textarea) {
      return
    }

    const syntaxStyle = SyntaxStyle.create()
    const styles: DiagnosticStyleRegistry = {
      errorStyleId: syntaxStyle.registerStyle("editor-diagnostic-error", {
        fg: coerceSyntaxColor(theme.errorFg),
        underline: true,
      }),
      infoStyleId: syntaxStyle.registerStyle("editor-diagnostic-info", {
        fg: coerceSyntaxColor(theme.mutedFg),
        underline: true,
      }),
      syntaxStyle,
      warningStyleId: syntaxStyle.registerStyle("editor-diagnostic-warning", {
        fg: coerceSyntaxColor(theme.warningFg),
        underline: true,
      }),
    }

    diagnosticStylesRef.current = styles
    textarea.syntaxStyle = syntaxStyle
    applyEditorDiagnosticHighlights(textarea, visibleAnalysis, props.editor.text, styles)

    return () => {
      if (!textarea.isDestroyed) {
        textarea.removeHighlightsByRef(EDITOR_DIAGNOSTIC_HIGHLIGHT_REF)
      }
      if (!textarea.isDestroyed && textarea.syntaxStyle === syntaxStyle) {
        textarea.syntaxStyle = null
      }
      if (diagnosticStylesRef.current?.syntaxStyle === syntaxStyle) {
        diagnosticStylesRef.current = null
      }
      syntaxStyle.destroy()
    }
  }, [props.textareaRef, theme.errorFg, theme.mutedFg, theme.warningFg])

  useEffect(() => {
    const textarea = props.textareaRef.current
    if (!textarea) {
      return
    }

    applyEditorDiagnosticHighlights(textarea, visibleAnalysis, props.editor.text, diagnosticStylesRef.current)
  }, [props.editor.text, props.textareaRef, visibleAnalysis])

  const flyoutLayout = computeSuggestionMenuLayout(props.editor.suggestionMenu, containerRef.current, props.textareaRef.current)
  const analysisBanner = getEditorAnalysisBanner(visibleAnalysis, props.editor.text, theme)
  const canSave = !!props.editor.text.trim()

  return (
    <box
      ref={containerRef}
      flexDirection="column"
      flexGrow={1}
      position="relative"
    >
      <box flexDirection="row" gap={1}>
        <Shortcut keys="ctrl+x" label="Execute" enabled={focused} onKey={props.handleExecute} />
        <Shortcut keys="ctrl+d" label="Clear" enabled={focused} onKey={handleClear} />
        <Shortcut keys="ctrl+r" label="History" enabled={focused} onKey={props.onHistory} />
        {props.onSaveChanges && props.savedQuery && (
          <Shortcut keys="ctrl+s" label="Save Changes" enabled={focused && canSave} onKey={props.onSaveChanges} />
        )}
        {props.onSaveAsNew && (
          <Shortcut
            keys="ctrl+shift+s"
            label={props.savedQuery ? "Fork" : "Save New"}
            enabled={focused && canSave}
            onKey={props.onSaveAsNew}
          />
        )}
        {props.onAddConnection && <Shortcut keys="ctrl+n" label="Add Conn" enabled={focused} onKey={props.onAddConnection} />}
      </box>
      <textarea
        ref={props.textareaRef}
        focused={focused}
        initialValue={props.editor.text}
        onContentChange={() => scheduleSyncEditorState("content")}
        onCursorChange={() => scheduleSyncEditorState("cursor")}
        onSubmit={props.handleExecute}
      />
      {analysisBanner && (
        <box
          backgroundColor={theme.inputBg}
          bottom={0}
          border={["top"]}
          borderColor={analysisBanner.borderColor}
          borderStyle="single"
          left={0}
          position="absolute"
          right={0}
          zIndex={3}
        >
          <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
            <text fg={analysisBanner.titleFg} truncate wrapMode="none">
              {analysisBanner.title}
            </text>
            {analysisBanner.location && (
              <text fg={theme.mutedFg} truncate wrapMode="none">
                {analysisBanner.location}
              </text>
            )}
          </box>
          {analysisBanner.detail && (
            <box paddingLeft={1} paddingRight={1}>
              <text fg={analysisBanner.detailFg} truncate wrapMode="none">
                {analysisBanner.detail}
              </text>
            </box>
          )}
        </box>
      )}
      {flyoutLayout && (
        <SuggestionMenuFlyout
          focusedItemId={props.editor.suggestionMenu.focusedItemId}
          items={flyoutLayout.items}
          left={flyoutLayout.left}
          status={props.editor.suggestionMenu.status}
          top={flyoutLayout.top}
          width={flyoutLayout.width}
          error={props.editor.suggestionMenu.error}
          theme={theme}
        />
      )}
      <FocusHalo />
    </box>
  )
}

function getVisibleEditorAnalysis(editor: EditorState): EditorState["analysis"] {
  if (editor.analysis.status === "idle") {
    return editor.analysis
  }

  return editor.analysis.requestedText === editor.text ? editor.analysis : { status: "idle" }
}

function getEditorAnalysisBanner(
  analysis: EditorState["analysis"],
  text: string,
  theme: ReturnType<typeof useTheme>,
): EditorAnalysisBanner | undefined {
  switch (analysis.status) {
    case "idle":
      return undefined
    case "loading":
      return {
        borderColor: theme.borderColor,
        detailFg: theme.mutedFg,
        title: "Analyzing query",
        titleFg: theme.mutedFg,
      }
    case "error":
      return {
        borderColor: theme.errorFg,
        detail: analysis.error ?? "Explain failed.",
        detailFg: theme.errorFg,
        title: "Analysis failed",
        titleFg: theme.errorFg,
      }
    case "ready": {
      const result = analysis.result
      if (!result || result.status === "unsupported") {
        return undefined
      }
      if (result.status === "invalid") {
        const diagnostic = result.diagnostics[0]
        const extraCount = Math.max(0, result.diagnostics.length - 1)
        return {
          borderColor: theme.errorFg,
          detail: `${diagnostic?.message ?? "Invalid query."}${extraCount > 0 ? ` (+${extraCount} more)` : ""}`,
          detailFg: theme.errorFg,
          location: formatDiagnosticLocation(text, diagnostic?.range),
          title: "Invalid query",
          titleFg: theme.errorFg,
        }
      }
      return {
        borderColor: theme.successFg,
        detail: result.columns?.length
          ? `Columns: ${result.columns.map((column) => (column.type ? `${column.name}: ${column.type}` : column.name)).join(", ")}`
          : undefined,
        detailFg: theme.mutedFg,
        title: "Query is valid",
        titleFg: theme.successFg,
      }
    }
  }
}

function applyEditorDiagnosticHighlights(
  textarea: TextareaRenderable,
  analysis: EditorState["analysis"],
  text: string,
  styles: DiagnosticStyleRegistry | null,
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

function getDiagnosticStyleId(styles: DiagnosticStyleRegistry, severity: "error" | "warning" | "info"): number {
  switch (severity) {
    case "warning":
      return styles.warningStyleId
    case "info":
      return styles.infoStyleId
    default:
      return styles.errorStyleId
  }
}

function normalizeHighlightRange(rangeText: string, range: EditorRange | undefined): EditorRange | undefined {
  if (!range) {
    return undefined
  }

  const start = clampValue(range.start, 0, rangeText.length)
  const end = clampValue(range.end, 0, rangeText.length)
  if (end > start) {
    return { end, start }
  }
  if (start < rangeText.length) {
    return { end: start + 1, start }
  }
  if (start > 0) {
    return { end: start, start: start - 1 }
  }
  return undefined
}

function formatDiagnosticLocation(text: string, range: EditorRange | undefined): string | undefined {
  const normalized = normalizeHighlightRange(text, range)
  if (!normalized) {
    return undefined
  }

  const start = offsetToLineColumn(text, normalized.start)
  const end = offsetToLineColumn(text, Math.max(normalized.start, normalized.end - 1))

  if (start.line === end.line) {
    if (start.column === end.column) {
      return `L${start.line}:C${start.column}`
    }
    return `L${start.line}:C${start.column}-${end.column}`
  }

  return `L${start.line}:C${start.column} - L${end.line}:C${end.column}`
}

function offsetToLineColumn(text: string, offset: number): {
  column: number
  line: number
} {
  const clampedOffset = clampValue(offset, 0, text.length)
  let line = 1
  let lineStart = 0

  for (let index = 0; index < clampedOffset; index += 1) {
    if (text[index] === "\n") {
      line += 1
      lineStart = index + 1
    }
  }

  return {
    column: clampedOffset - lineStart + 1,
    line,
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
          <text fg={props.theme.mutedFg}>{statusMessage}</text>
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
            <text flexShrink={1}>{item.label}</text>
            {item.kind && (
              <text fg={props.theme.mutedFg}>
                {` ${item.kind}`}
              </text>
            )}
            {item.detail && (
              <text fg={props.theme.mutedFg}>
                {` | ${item.detail}`}
              </text>
            )}
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

function selectVisibleSuggestionItems(items: SuggestionItem[], focusedItemId: string | undefined, maxVisibleItems: number): SuggestionItem[] {
  if (items.length <= maxVisibleItems) {
    return items
  }

  const focusedIndex = items.findIndex((item) => item.id === focusedItemId)
  const targetIndex = focusedIndex >= 0 ? focusedIndex : 0
  const start = clampValue(targetIndex - Math.floor(maxVisibleItems / 2), 0, items.length - maxVisibleItems)
  return items.slice(start, start + maxVisibleItems)
}

function measureSuggestionMenuWidth(items: SuggestionItem[], statusMessage: string | undefined, containerWidth: number): number {
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

export function detectMentionSuggestionTrigger(text: string, cursorOffset: number): MentionSuggestionTrigger | undefined {
  const clampedCursorOffset = clampValue(cursorOffset, 0, text.length)
  let start = clampedCursorOffset
  while (start > 0 && !isMentionBoundaryCharacter(text[start - 1]!)) {
    start -= 1
  }

  let end = clampedCursorOffset
  while (end < text.length && !isMentionBoundaryCharacter(text[end]!)) {
    end += 1
  }

  const token = text.slice(start, end)
  if (!token.startsWith("@") || token.length < 1 || token.indexOf("@", 1) >= 0) {
    return undefined
  }

  return {
    query: token.slice(1),
    replacementRange: {
      end,
      start,
    },
  }
}

function didInsertMentionTrigger(previousText: string, nextText: string, replacementRange: EditorRange): boolean {
  if (nextText.length <= previousText.length) {
    return false
  }

  const prefixLength = longestCommonPrefixLength(previousText, nextText)
  const suffixLength = longestCommonSuffixLength(previousText, nextText, prefixLength)
  const insertedText = nextText.slice(prefixLength, nextText.length - suffixLength)
  const removedText = previousText.slice(prefixLength, previousText.length - suffixLength)

  return insertedText === "@" && removedText === "" && replacementRange.start === prefixLength
}

function longestCommonPrefixLength(previousText: string, nextText: string): number {
  const maxLength = Math.min(previousText.length, nextText.length)
  let index = 0

  while (index < maxLength && previousText[index] === nextText[index]) {
    index += 1
  }

  return index
}

function longestCommonSuffixLength(previousText: string, nextText: string, prefixLength: number): number {
  const previousRemainderLength = previousText.length - prefixLength
  const nextRemainderLength = nextText.length - prefixLength
  const maxLength = Math.min(previousRemainderLength, nextRemainderLength)
  let index = 0

  while (
    index < maxLength &&
    previousText[previousText.length - 1 - index] === nextText[nextText.length - 1 - index]
  ) {
    index += 1
  }

  return index
}

function rangesEqual(left: EditorRange | undefined, right: EditorRange): boolean {
  return left?.start === right.start && left?.end === right.end
}

function isMentionBoundaryCharacter(char: string): boolean {
  return /\s|[()[\]{},;:+\-*/%<>=!?'"`|]/.test(char)
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function coerceSyntaxColor(color: string): SyntaxColor {
  return color as unknown as SyntaxColor
}
