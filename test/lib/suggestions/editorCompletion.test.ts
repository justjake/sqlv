import { describe, expect, test } from "bun:test"
import {
  decideEditorSuggestionMenu,
  detectIdentifierSuggestionTrigger,
  type EditorSuggestionMenuSnapshot,
} from "../../../src/lib/suggestions/editorCompletion"

function createSuggestionMenu(patch: Partial<EditorSuggestionMenuSnapshot> = {}): EditorSuggestionMenuSnapshot {
  return {
    open: false,
    query: "",
    ...patch,
  }
}

describe("editorCompletion", () => {
  test("detects object-name identifier completions without opening for aliases", () => {
    expect(detectIdentifierSuggestionTrigger("select * from us", "select * from us".length)).toEqual({
      query: "us",
      replacementRange: {
        end: "select * from us".length,
        start: "select * from ".length,
      },
    })

    expect(detectIdentifierSuggestionTrigger("select * from users us", "select * from users us".length)).toBeUndefined()

    expect(detectIdentifierSuggestionTrigger("select * from users, ord", "select * from users, ord".length)).toEqual({
      query: "ord",
      replacementRange: {
        end: "select * from users, ord".length,
        start: "select * from users, ".length,
      },
    })
  })

  test("opens mention suggestions only when @ is newly inserted", () => {
    expect(
      decideEditorSuggestionMenu({
        cursorOffset: 1,
        menu: createSuggestionMenu(),
        previousText: "",
        reason: "content",
        text: "@",
      }),
    ).toEqual({
      input: {
        cursorOffset: 1,
        documentText: "@",
        replacementRange: {
          end: 1,
          start: 0,
        },
        trigger: {
          context: {
            triggerText: "@",
          },
          kind: "mention",
          query: "",
        },
      },
      kind: "open",
    })

    expect(
      decideEditorSuggestionMenu({
        cursorOffset: 2,
        menu: createSuggestionMenu(),
        previousText: "@ab",
        reason: "content",
        text: "@a",
      }),
    ).toEqual({ kind: "none" })
  })

  test("opens identifier suggestions scoped to the selected connection", () => {
    expect(
      decideEditorSuggestionMenu({
        cursorOffset: "select * from us".length,
        menu: createSuggestionMenu(),
        previousText: "select * from u",
        reason: "content",
        selectedConnectionId: "conn-1",
        text: "select * from us",
      }),
    ).toEqual({
      input: {
        cursorOffset: "select * from us".length,
        documentText: "select * from us",
        replacementRange: {
          end: "select * from us".length,
          start: "select * from ".length,
        },
        scope: {
          connectionId: "conn-1",
          kind: "selected-connection",
        },
        trigger: {
          context: {
            completionKind: "identifier",
          },
          kind: "identifier",
          query: "us",
        },
      },
      kind: "open",
    })
  })

  test("closes an open identifier menu when the cursor leaves an object-name context", () => {
    expect(
      decideEditorSuggestionMenu({
        cursorOffset: "select us".length,
        menu: createSuggestionMenu({
          open: true,
          query: "us",
          replacementRange: {
            end: "select * from us".length,
            start: "select * from ".length,
          },
          scope: {
            connectionId: "conn-1",
            kind: "selected-connection",
          },
          trigger: {
            kind: "identifier",
            query: "us",
          },
        }),
        previousText: "select u",
        reason: "content",
        selectedConnectionId: "conn-1",
        text: "select us",
      }),
    ).toEqual({ kind: "close" })
  })
})
