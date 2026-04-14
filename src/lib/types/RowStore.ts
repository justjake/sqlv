import { EpochMillis } from "./Log"
import type { OrderString } from "./Order"
import type { Identifier, SQL } from "./SQL"
import { mustBeArray, mustBeOptionalSingle, mustBeSingle } from "./unreachable"

export type BaseRow = {
  id: string
  type: string
  createdAt: EpochMillis
  updatedAt?: EpochMillis
  sort?: OrderString
  json?: unknown
}

export type RowRef<T extends BaseRow> = Pick<T, "id" | "type">

export type RowStore<Row extends BaseRow> = {
  query<T extends Row>(q: (table: Identifier) => SQL<T>): Promise<T[]>
  get<T extends Row>(ref: RowRef<T>): Promise<T | undefined>
  insert<T extends Row>(row: T): Promise<T>
  upsert<T extends Row>(row: T): Promise<T>
  update<T extends Row>(row: RowRef<T>, patch: Partial<T>): Promise<void>
  delete<T extends Row>(row: RowRef<T>): Promise<void>
}

export class RowHandle<T extends BaseRow> {
  constructor(
    public readonly store: RowStore<T>,
    public readonly ref: RowRef<T>,
  ) {}

  get(): Promise<T | undefined> {
    return this.store.get(this.ref)
  }

  set(row: Omit<T, "id" | "type">): Promise<T> {
    return this.store.upsert({
      ...row,
      updatedAt: EpochMillis.now(),
      ...this.ref,
    } as T)
  }

  update(patch: Partial<T>): Promise<void> {
    return this.store.update(this.ref, {
      ...patch,
      ...this.ref,
      updatedAt: EpochMillis.now(),
    })
  }
}

export type RowGet<T extends BaseRow> = { type: "get"; ref: RowRef<T> }
export type RowQuery<T extends BaseRow> = { type: "query"; q: (table: Identifier) => SQL<T> }
export type RowInsert<T extends BaseRow> = { type: "insert"; row: T }
export type RowUpsert<T extends BaseRow> = { type: "upsert"; row: T }
export type RowUpdate<T extends BaseRow> = { type: "update"; ref: RowRef<T>; patch: Partial<T> }
export type RowDelete<T extends BaseRow> = { type: "delete"; ref: RowRef<T> }

export type RowAction<T extends BaseRow> =
  | RowQuery<T>
  | RowGet<T>
  | RowInsert<T>
  | RowUpsert<T>
  | RowUpdate<T>
  | RowDelete<T>

export function rowDispatcher<T extends BaseRow>(
  dispatch: <T2 extends T>(action: RowAction<T2>) => Promise<T2 | T2[] | undefined>,
): RowStore<T> {
  return {
    query: async (q) => dispatch({ type: "query", q }).then(mustBeArray),
    delete: async (ref) => dispatch({ type: "delete", ref }).then(() => void 0),
    get: async (ref) => dispatch({ type: "get", ref }).then(mustBeOptionalSingle),
    insert: async (row) => dispatch({ type: "insert", row }).then(mustBeSingle),
    upsert: async (row) => dispatch({ type: "upsert", row }).then(mustBeSingle),
    update: async (ref, patch) => dispatch({ type: "update", ref, patch }).then(() => void 0),
  }
}
