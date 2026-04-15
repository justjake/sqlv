import {
  RGBA,
  SyntaxStyle,
  TextAttributes,
  getBaseAttributes,
  treeSitterToTextChunks,
  type Highlight,
  type SimpleHighlight,
  type TextChunk,
  type ThemeTokenStyle,
} from "@opentui/core"

export const EDITOR_SYNTAX_HIGHLIGHT_REF = 4_200

const CIRCUS = {
  base00: "#191919",
  base01: "#202020",
  base02: "#303030",
  base03: "#5f5a60",
  base04: "#505050",
  base05: "#a7a7a7",
  base06: "#808080",
  base07: "#ffffff",
  base08: "#dc657d",
  base09: "#4bb1a7",
  base0A: "#c3ba63",
  base0B: "#84b97c",
  base0C: "#4bb1a7",
  base0D: "#639ee4",
  base0E: "#b888e2",
  base0F: "#b888e2",
} as const

const TREE_SITTER_THEME: ThemeTokenStyle[] = [
  {
    scope: ["default"],
    style: {
      background: CIRCUS.base02,
      foreground: CIRCUS.base05,
    },
  },
  {
    scope: ["comment"],
    style: {
      foreground: CIRCUS.base03,
      italic: true,
    },
  },
  {
    scope: ["keyword", "conditional", "exception", "repeat", "storageclass", "keyword.operator", "type.qualifier"],
    style: {
      foreground: CIRCUS.base0E,
    },
  },
  {
    scope: ["operator"],
    style: {
      foreground: CIRCUS.base05,
    },
  },
  {
    scope: ["string", "string.special", "character", "markup.raw"],
    style: {
      foreground: CIRCUS.base0B,
    },
  },
  {
    scope: ["number", "float", "boolean", "constant", "attribute"],
    style: {
      foreground: CIRCUS.base09,
    },
  },
  {
    scope: ["function", "function.call", "method", "method.call", "constructor"],
    style: {
      foreground: CIRCUS.base0D,
    },
  },
  {
    scope: ["type", "type.builtin", "type.definition", "tag"],
    style: {
      foreground: CIRCUS.base0A,
    },
  },
  {
    scope: ["variable", "variable.parameter", "parameter", "field", "property"],
    style: {
      foreground: CIRCUS.base08,
    },
  },
  {
    scope: ["label"],
    style: {
      foreground: CIRCUS.base0F,
    },
  },
  {
    scope: ["punctuation", "punctuation.bracket", "punctuation.delimiter"],
    style: {
      foreground: CIRCUS.base05,
    },
  },
]

export const editorTextareaColors = {
  backgroundColor: CIRCUS.base02,
  cursorColor: CIRCUS.base07,
  focusedBackgroundColor: CIRCUS.base02,
  focusedTextColor: CIRCUS.base05,
  placeholderColor: CIRCUS.base04,
  selectionBg: CIRCUS.base03,
  selectionFg: CIRCUS.base07,
  textColor: CIRCUS.base05,
} as const

export const editorLineNumberColors = {
  backgroundColor: CIRCUS.base01,
  textColor: CIRCUS.base03,
} as const

export const editorCursorLineColors = {
  contentBackgroundColor: blendHex(CIRCUS.base02, CIRCUS.base01, 0.45),
  gutterBackgroundColor: blendHex(CIRCUS.base01, CIRCUS.base02, 0.3),
} as const

export const editorInlineAnalysisColors = {
  errorTextColor: CIRCUS.base08,
  textColor: CIRCUS.base0C,
} as const

export type EditorSyntaxStyleRegistry = {
  defaultStyleSignature: string
  errorStyleId: number
  infoStyleId: number
  syntaxStyle: SyntaxStyle
  syntaxStyleIds: Map<string, number>
  warningStyleId: number
}

export function createEditorSyntaxStyleRegistry(): EditorSyntaxStyleRegistry {
  const syntaxStyle = SyntaxStyle.fromTheme(TREE_SITTER_THEME)

  const errorStyleId = syntaxStyle.registerStyle("editor-diagnostic-error", {
    fg: RGBA.fromHex(CIRCUS.base08),
    underline: true,
  })
  const warningStyleId = syntaxStyle.registerStyle("editor-diagnostic-warning", {
    fg: RGBA.fromHex(CIRCUS.base0A),
    underline: true,
  })
  const infoStyleId = syntaxStyle.registerStyle("editor-diagnostic-info", {
    fg: RGBA.fromHex(CIRCUS.base0D),
    underline: true,
  })

  return {
    defaultStyleSignature: createStyleSignature(syntaxStyle.mergeStyles("default")),
    errorStyleId,
    infoStyleId,
    syntaxStyle,
    syntaxStyleIds: new Map(),
    warningStyleId,
  }
}

export function buildEditorSyntaxHighlights(
  content: string,
  highlights: SimpleHighlight[],
  registry: EditorSyntaxStyleRegistry,
): Highlight[] {
  if (!content.length || highlights.length === 0) {
    return []
  }

  const chunks = treeSitterToTextChunks(content, highlights, registry.syntaxStyle, {
    enabled: false,
  })

  const ranges: Highlight[] = []
  let offset = 0

  for (const chunk of chunks) {
    const start = offset
    offset += chunk.text.length

    if (!chunk.text.length || offset <= start) {
      continue
    }

    const signature = createStyleSignature(chunk)
    if (signature === registry.defaultStyleSignature) {
      continue
    }

    ranges.push({
      end: offset,
      start,
      styleId: getOrCreateChunkStyleId(chunk, signature, registry),
    })
  }

  return ranges
}

function getOrCreateChunkStyleId(
  chunk: Pick<TextChunk, "attributes" | "bg" | "fg">,
  signature: string,
  registry: EditorSyntaxStyleRegistry,
): number {
  const cached = registry.syntaxStyleIds.get(signature)
  if (cached !== undefined) {
    return cached
  }

  const attributes = getBaseAttributes(chunk.attributes ?? 0)
  const styleId = registry.syntaxStyle.registerStyle(`editor-syntax-chunk-${registry.syntaxStyleIds.size}`, {
    bg: chunk.bg,
    bold: (attributes & TextAttributes.BOLD) !== 0,
    dim: (attributes & TextAttributes.DIM) !== 0,
    fg: chunk.fg,
    italic: (attributes & TextAttributes.ITALIC) !== 0,
    underline: (attributes & TextAttributes.UNDERLINE) !== 0,
  })

  registry.syntaxStyleIds.set(signature, styleId)
  return styleId
}

function createStyleSignature(style: {
  attributes?: number
  bg?: RGBA
  fg?: RGBA
}): string {
  return [colorSignature(style.fg), colorSignature(style.bg), getBaseAttributes(style.attributes ?? 0)].join("|")
}

function colorSignature(color: RGBA | undefined): string {
  return color ? color.toInts().join(",") : "none"
}

function blendHex(baseHex: string, targetHex: string, ratio: number): string {
  const amount = clamp(ratio, 0, 1)
  const base = hexToRgb(baseHex)
  const target = hexToRgb(targetHex)
  const mix = (left: number, right: number) => Math.round(left + (right - left) * amount)

  return `#${mix(base.r, target.r).toString(16).padStart(2, "0")}${mix(base.g, target.g).toString(16).padStart(2, "0")}${mix(base.b, target.b).toString(16).padStart(2, "0")}`
}

function hexToRgb(hex: string): { b: number; g: number; r: number } {
  return {
    b: parseInt(hex.slice(5, 7), 16),
    g: parseInt(hex.slice(3, 5), 16),
    r: parseInt(hex.slice(1, 3), 16),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
