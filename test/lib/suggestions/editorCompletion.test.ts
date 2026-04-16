import { describe, expect, test } from "bun:test"

import { createEditorBuffer, createEditorChange } from "../../../src/domain/editor/buffer"
import {
  closedEditorCompletionState,
  decideEditorCompletion,
  detectIdentifierCompletion,
} from "../../../src/domain/editor/completion"

describe("editorCompletion", () => {
  test("detects object-name identifier completions without opening for aliases", () => {
    expect(detectIdentifierCompletion(createEditorBuffer("select * from us"), "conn-1")).toEqual({
      kind: "identifier",
      query: "us",
      replaceRange: {
        end: "select * from us".length,
        start: "select * from ".length,
      },
      scope: {
        connectionId: "conn-1",
        kind: "selected-connection",
      },
    })

    expect(detectIdentifierCompletion(createEditorBuffer("select * from users us"), "conn-1")).toBeUndefined()

    expect(detectIdentifierCompletion(createEditorBuffer("select * from users, ord"), "conn-1")).toEqual({
      kind: "identifier",
      query: "ord",
      replaceRange: {
        end: "select * from users, ord".length,
        start: "select * from users, ".length,
      },
      scope: {
        connectionId: "conn-1",
        kind: "selected-connection",
      },
    })
  })

  test("opens mention suggestions only when @ is newly inserted", () => {
    expect(
      decideEditorCompletion({
        change: createEditorChange(createEditorBuffer(""), { cursorOffset: 1, text: "@" }, "content"),
        completion: closedEditorCompletionState(),
        scopeMode: "all-connections",
      }),
    ).toEqual({
      context: {
        kind: "mention",
        query: "",
        replaceRange: {
          end: 1,
          start: 0,
        },
        scope: {
          kind: "all-connections",
        },
      },
      kind: "open",
    })

    expect(
      decideEditorCompletion({
        change: createEditorChange(createEditorBuffer("@ab"), { cursorOffset: 2, text: "@a" }, "content"),
        completion: closedEditorCompletionState(),
        scopeMode: "all-connections",
      }),
    ).toEqual({ kind: "none" })
  })

  test("opens identifier suggestions scoped to the selected connection", () => {
    expect(
      decideEditorCompletion({
        change: createEditorChange(
          createEditorBuffer("select * from u"),
          {
            cursorOffset: "select * from us".length,
            text: "select * from us",
          },
          "content",
        ),
        completion: closedEditorCompletionState(),
        scopeMode: "all-connections",
        selectedConnectionId: "conn-1",
      }),
    ).toEqual({
      context: {
        kind: "identifier",
        query: "us",
        replaceRange: {
          end: "select * from us".length,
          start: "select * from ".length,
        },
        scope: {
          connectionId: "conn-1",
          kind: "selected-connection",
        },
      },
      kind: "open",
    })
  })

  test("closes an open identifier completion when the cursor leaves an object-name context", () => {
    expect(
      decideEditorCompletion({
        change: createEditorChange(
          createEditorBuffer("select u"),
          {
            cursorOffset: "select us".length,
            text: "select us",
          },
          "content",
        ),
        completion: {
          context: {
            kind: "identifier",
            query: "us",
            replaceRange: {
              end: "select * from us".length,
              start: "select * from ".length,
            },
            scope: {
              connectionId: "conn-1",
              kind: "selected-connection",
            },
          },
          status: "ready",
        },
        scopeMode: "all-connections",
        selectedConnectionId: "conn-1",
      }),
    ).toEqual({ kind: "close" })
  })
})
