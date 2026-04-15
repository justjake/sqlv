import type { SqlVisor } from "../SqlVisor"
import type { Connection } from "../types/Connection"
import type { QueryableObjectInfo } from "../types/objects"
import type { SuggestionItem, SuggestionProvider, SuggestionRequest } from "./types"

type RankedSuggestion = {
  item: SuggestionItem
  rank: number
  sortLabel: string
}

export class KnownObjectsSuggestionProvider implements SuggestionProvider {
  readonly id = "known-objects"

  async getSuggestions(request: SuggestionRequest): Promise<SuggestionItem[]> {
    const state = request.engine.getState()
    const connections = state.connections.data ?? []
    const targetConnections = resolveConnections(request.engine, request.scope.kind === "selected-connection" ? request.scope.connectionId : undefined)
    const normalizedQuery = normalize(request.trigger.query ?? "")
    const ranked: RankedSuggestion[] = []

    for (const connection of targetConnections.length > 0 ? targetConnections : connections) {
      throwIfAborted(request.abortSignal)

      let objects = request.engine.getState().objectsByConnectionId[connection.id]?.data
      if (!objects) {
        try {
          objects = await request.engine.loadConnectionObjects(connection.id)
        } catch {
          continue
        }
      }

      throwIfAborted(request.abortSignal)

      for (const object of objects ?? []) {
        if (!isQueryableObject(object)) {
          continue
        }

        const item = createSuggestionItem(connection, object)
        const rank = matchRank(normalize(item.label), normalizedQuery)
        if (rank === undefined) {
          continue
        }

        ranked.push({
          item,
          rank,
          sortLabel: normalize(item.label),
        })
      }
    }

    ranked.sort(compareRankedSuggestions)
    return ranked.map((entry) => entry.item)
  }
}

function resolveConnections(engine: SqlVisor, connectionId: string | undefined): Connection<any>[] {
  const connections = engine.getState().connections.data ?? []
  if (!connectionId) {
    return connections
  }
  const selected = connections.find((connection) => connection.id === connectionId)
  return selected ? [selected] : connections
}

function createSuggestionItem(connection: Connection<any>, object: QueryableObjectInfo): SuggestionItem {
  const label = formatObjectLabel(object)
  return {
    id: `known-object:${connection.id}:${object.type}:${object.database ?? ""}:${object.schema ?? ""}:${object.name}`,
    connectionId: connection.id,
    detail: `${connection.name} | ${object.type}`,
    insertText: formatObjectInsertText(object),
    kind: object.type,
    label,
  }
}

function isQueryableObject(object: unknown): object is QueryableObjectInfo {
  if (!object || typeof object !== "object") {
    return false
  }

  const type = (object as { type?: string }).type
  return type === "table" || type === "view" || type === "matview"
}

function formatObjectLabel(object: QueryableObjectInfo): string {
  const segments = [object.database !== "main" ? object.database : undefined, object.schema, object.name].filter(
    (segment): segment is string => Boolean(segment),
  )
  return segments.join(".") || object.name
}

function formatObjectInsertText(object: QueryableObjectInfo): string {
  const segments = [object.database !== "main" ? object.database : undefined, object.schema, object.name].filter(
    (segment): segment is string => Boolean(segment),
  )
  return (segments.length > 0 ? segments : [object.name]).map(quoteIdentifier).join(".")
}

function quoteIdentifier(identifier: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    return identifier
  }
  return `"${identifier.replaceAll(`"`, `""`)}"`
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function matchRank(label: string, query: string): number | undefined {
  if (!query) {
    return 0
  }
  if (label.startsWith(query)) {
    return 0
  }
  if (label.includes(query)) {
    return 1
  }
  if (isSubsequence(query, label)) {
    return 2
  }
  return undefined
}

function isSubsequence(query: string, label: string): boolean {
  let index = 0
  for (const char of label) {
    if (char === query[index]) {
      index += 1
      if (index === query.length) {
        return true
      }
    }
  }
  return query.length === 0
}

function compareRankedSuggestions(left: RankedSuggestion, right: RankedSuggestion): number {
  return (
    left.rank - right.rank ||
    left.sortLabel.localeCompare(right.sortLabel) ||
    (left.item.connectionId ?? "").localeCompare(right.item.connectionId ?? "") ||
    left.item.id.localeCompare(right.item.id)
  )
}

function throwIfAborted(signal: AbortSignal): void {
  if (typeof signal.throwIfAborted === "function") {
    signal.throwIfAborted()
    return
  }
  if (!signal.aborted) {
    return
  }

  const error = signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? "Aborted"))
  error.name = "AbortError"
  throw error
}
