import type { QueryState as TanstackQueryState } from "@tanstack/query-core"

export type { FetchStatus, QueryStatus } from "@tanstack/query-core"

export type QueryState<TData, TError = Error> = TanstackQueryState<TData, TError>

export function pendingQueryState<TData, TError = Error>(data?: TData): QueryState<TData, TError> {
  return {
    data,
    dataUpdateCount: data === undefined ? 0 : 1,
    dataUpdatedAt: data === undefined ? 0 : Date.now(),
    error: null,
    errorUpdateCount: 0,
    errorUpdatedAt: 0,
    fetchFailureCount: 0,
    fetchFailureReason: null,
    fetchMeta: null,
    isInvalidated: false,
    status: data === undefined ? "pending" : "success",
    fetchStatus: "idle",
  }
}

export function queryStateOrPending<TData, TError = Error>(
  state: QueryState<TData, TError> | undefined,
  data?: TData,
): QueryState<TData, TError> {
  return state ?? pendingQueryState(data)
}
