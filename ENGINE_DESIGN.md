# SqlVisor Engine Design

This document describes the engine, storage, and public-API design for sqlv. It
captures the target shape only. Historical motions, migration order, and
legacy shims are out of scope.

---

## 1. Overview

`sqlv` is a SQL-interaction tool with a reusable engine and multiple hosts
(terminal UI today, browser tomorrow). The engine owns all durable state,
query execution orchestration, and in-memory workspace state. Hosts render
engine state and issue commands through the public API.

Design priorities, in order:

1. **Policy / mechanism separation.** Lower layers provide capabilities;
   upper layers make product decisions.
2. **Platform neutrality of the engine.** Currently supported platforms:
   Bun with libsql. The design accommodates additional drivers and
   platforms as they are added — for example, a browser host with
   sqlite-wasm over OPFS. Only the driver, secret storage, path resolution,
   and migration runner are platform-specific; the engine, schema,
   services, and API are platform-neutral. Sync drivers (like
   better-sqlite3) are out of scope unless a parallel sync `StorageDb`
   type is added later.
3. **Store-first in-memory state.** The engine's in-memory layer is a
   TanStack Store graph. Writable source state exists exactly once in a
   single root store. Shared computed state uses derived stores; view-local
   projections use selectors instead of duplicating state.
4. **Type-safe, boring APIs.** Branded IDs, discriminated unions, explicit
   method signatures. No stringly-typed handles, no generic row envelopes,
   no runtime type dispatch where static types work.
5. **Durable audit of everything.** Every state mutation writes both the
   affected row and an audit event in a single transaction. Queries live in
   their own table; everything else in the audit log.

---

## 2. Architectural Layers

| Layer             | Imports                                                  | Intent                                             |
| ----------------- | -------------------------------------------------------- | -------------------------------------------------- |
| `domain/`         | nothing                                                  | Pure nouns, branded IDs, domain helpers, utilities |
| `spi/`            | domain                                                   | Adapter extension contracts                        |
| `api/`            | domain, spi, engine                                      | World-public contracts + aggregate type            |
| `engine/`         | domain, spi, api (types)                                 | Private orchestration, services, store graph, storage schema |
| `adapters/`       | domain, spi, sibling adapter-family files, external libs | Protocol implementations                           |
| `platforms/`      | domain, spi, engine, api, external libs                  | Driver wiring, secrets, paths, composition roots   |
| `apps/framework/` | api, domain, external libs                               | Reusable host framework                            |
| `apps/*`          | api, domain, apps/framework, external libs               | Concrete hosts                                     |

Forbidden:

- `adapters/` ↔ `engine/`, `platforms/`, `apps/`
- `apps/` → `engine/` or `platforms/` internals
- `platforms/*` → `apps/`
- any import of `libsql`, `drizzle-kit`, Node filesystem APIs from `engine/`,
  `api/`, `domain/`, or `spi/`

Composition roots — the only places that instantiate concrete wiring — live
at platform entrypoints: `platforms/bun/createBunSqlVisor.ts`,
`platforms/browser/createBrowserSqlVisor.ts`.

---

## 3. Domain Model

### 3.1 Layout

```
src/domain/
  primitive/           domain-public primitives (appear in api types)
    EpochMillis.ts
    Id.ts
    Json.ts
    Protocol.ts
  util/                runtime helpers; unlikely to surface in api types
    defer.ts
    errors.ts
    Result.ts
    unreachable.ts
  connection/
    Connection.ts
  session/
    Session.ts
  query/
    QueryExecution.ts
    SQL.ts
    formatQuery.ts
  savedQuery/
    SavedQuery.ts
  audit/
    AuditEvent.ts
  catalog/
    ObjectInfo.ts
    Explain.ts
  editor/
    analysis.ts
    buffer.ts
    completion.ts
    state.ts
    suggestionMenu.ts
    text.ts
```

No `index.ts` anywhere in `domain/`. Same-folder imports use relative paths
(`./sibling`); cross-folder imports use aliases (`#domain/connection/Connection`).

### 3.2 Primitives

**`EpochMillis`** — branded `number & { __epochMillis__: true }`. Milliseconds
since Unix epoch, matching `Date.now()`. Constructor `EpochMillis(n)` casts;
`EpochMillis.now()` returns current time. All timestamps in domain + schema
use this type.

**`Id<Tag>`** — branded `string & { [__idBrand]: Tag }`. The single generic
for all branded identifiers. Constructor `Id<Tag>(str)` casts a string;
factory `createId<Tag>()` returns a fresh UUID v4 as `Id<Tag>`. Domain
folders define tag-specific aliases:

```ts
export type ConnectionId = Id<"Connection">;
export type SessionId = Id<"Session">;
export type SavedQueryId = Id<"SavedQuery">;
export type QueryExecutionId = Id<"QueryExecution">;
export type AuditEventId = Id<"AuditEvent">;
```

`createConnectionId()`, `createSessionId()` etc. are one-line convenience
factories co-located with each type.

**`Json`** — recursive union of JSON primitives, arrays, and objects.
`JsonObject`, `JsonArray`, `JsonPrimitive` are exported. `JsonEncoded<T>`
is the phantom-typed stringified form used when JSON is passed as text.

**`Protocol`** — canonical home is `domain/primitive/Protocol.ts`. The
`ProtocolToConfig` interface is the extension point; adapter modules
augment it via declaration merging to register their config type for a
protocol literal. Every registered config must be JSON-safe.

```ts
// domain/primitive/Protocol.ts
import type { Json } from "./Json"

export interface ProtocolToConfig extends Record<string, Json> {}
export type Protocol = Extract<keyof ProtocolToConfig, string>
export type ConfigFor<P extends Protocol> = ProtocolToConfig[P]
```

```ts
// adapters/postgres/PgAdapter.ts
declare module "#domain/primitive/Protocol" {
  interface ProtocolToConfig {
    postgres: PostgresConfig     // must satisfy Json
  }
}
export class PostgresAdapter implements Adapter<PostgresConfig> { … }
```

Putting the registry in `domain/primitive/` keeps the `domain → nothing`
layer rule intact. `spi/Adapter.ts` is a consumer of the domain-level
extension point. Every downstream type that refers to "the config for this
protocol" walks through a single indirection (`ProtocolToConfig[P]`)
rather than inferring the config from an adapter class type.

**`Adapter<Config extends Json>`** (in `spi/`) has exactly one type
parameter, constrained to `Json` so configs round-trip through the JSON
config column without a codec. No `Arg` or `Features` parameters.
`RegisteredAdapter<P extends Protocol = Protocol>` is
`Adapter<ConfigFor<P>> & { readonly protocol: P }` — the shape returned
by `AdaptersService.get(protocol)`.

The `Json` constraint applies only to `Config`. Row and SQL argument types
are not constrained here; adapters that return non-JSON driver-native
values are responsible for what they persist. This is deliberately
permissive — tightening it is a separate design decision.

### 3.3 Utilities

**`defer.ts`** — `aborter(signal, handler)` attaches a one-shot handler to
an `AbortSignal` using the `using` disposable pattern. Removes the listener
on scope exit.

**`errors.ts`** — `preserveErrorStack(target, source)` copies a `.stack`
from one error to another while keeping the new error's name/message.

**`Result.ts`** — `Result<T, E>` = `Ok<T> | Err<E>`. Functional helpers
(`Result.ok`, `Result.err`, `Result.toError`). Never exposed on api types.

**`unreachable.ts`** — `mustBeArray(v)`, `mustBeSingle(v)`, `mustBeOptionalSingle(v)`
type-assertion helpers that throw on mismatch. Used at runtime boundaries
where TypeScript's inference needs a hand.

### 3.4 `Connection`

`Connection` is a discriminated union keyed by `protocol`. Each arm binds
its protocol literal to the config shape declared in `ProtocolToConfig`.
There is no `Connection<any>`, and there is no way to construct a
`Connection` whose `config` disagrees with its `protocol` — they are
locked together by the type system.

```ts
export type ConnectionId = Id<"Connection">;

export type ConnectionOf<P extends Protocol> = {
  id: ConnectionId;
  name: string;
  protocol: P;
  config: ConfigFor<P>;
  createdAt: EpochMillis;
  updatedAt?: EpochMillis;
};

export type Connection = { [P in Protocol]: ConnectionOf<P> }[Protocol];

export type AddConnectionInput<P extends Protocol = Protocol> = {
  id?: ConnectionId;
  name: string;
  protocol: P;
  config: ConfigFor<P>;
};

export type UpdateConnectionInput<P extends Protocol = Protocol> = {
  name?: string;
  config?: ConfigFor<P>;
};
```

No `type` discriminator; no `order` field. Connections are identified by
`ConnectionId`. The `config` field is protocol-specific JSON, validated by
the adapter's `ConnectionSpec` on write.

Narrowing:

```ts
function describe(conn: Connection): string {
  switch (conn.protocol) {
    case "postgres": return `${conn.config.host}:${conn.config.port ?? 5432}`
    case "sqlite":   return conn.config.path
    …
  }
}
```

Invariants:

- `id` is assigned at creation and never changes.
- `name` is user-visible; may be non-unique but services surface duplicates
  consistently.
- `protocol` is immutable after creation; changing protocol is delete+add.
- `config` is opaque to the engine except for its JSON-roundtrippability
  and the adapter's own validation.
- `protocol` and `config` are _always_ consistent — `ConnectionOf<P>` makes
  any other combination a compile error.

#### `ConnectionSnapshot`

A JSON-safe flattened view of a connection used by audit event payloads
(`connection.updated` before/after diffs) and by historical references that
outlive the row itself (`query_executions.connection_name_snapshot`,
`connection_protocol_snapshot`).

```ts
export type ConnectionSnapshot = {
  id: ConnectionId
  name: string
  protocol: Protocol
  config: Json
  createdAt: EpochMillis
  updatedAt?: EpochMillis
}
```

`config` is `Json` here (not `ConfigFor<P>`) because the snapshot is a
serialization artifact: its purpose is to round-trip through JSON in audit
rows and compare before/after, not to dispatch on protocol.

### 3.5 `Session`

```ts
export type SessionId = Id<"Session">;

export type Session = {
  id: SessionId;
  app: string;
  createdAt: EpochMillis;
  endedAt?: EpochMillis;
};
```

A session represents one run of a host application (one TUI invocation, one
browser tab). Sessions are created at engine boot and ended on graceful
disposal. Every mutation records its originating session via foreign key.

### 3.6 `Query`

#### `QueryExecution`

`QueryExecution` is a status-discriminated union. Each status arm carries
exactly the fields that make sense for it — pending has no `finishedAt`,
error has no rows, success has both `rowCount` and `rows`. The type system
prevents code from checking `rows` on a failed execution or `error` on a
successful one.

```ts
export type QueryExecutionId = Id<"QueryExecution">
export type QueryInitiator = "user" | "system"
export type QueryRef = { queryId: QueryExecutionId }

type QueryExecutionBase = {
  id: QueryExecutionId
  sessionId: SessionId
  connectionId?: ConnectionId           // set to null when source connection is deleted
  connectionNameSnapshot: string        // captured at insert; immutable
  connectionProtocolSnapshot: Protocol
  savedQueryId?: SavedQueryId           // set to null when source saved query is deleted
  savedQueryNameSnapshot?: string       // captured at insert when savedQueryId was set
  parentAuditId?: AuditEventId          // set when run inside a flow
  initiator: QueryInitiator
  createdAt: EpochMillis
  updatedAt?: EpochMillis
  sql: { source: string; args: Json[] }
  sensitive: boolean
  database?: string
  schema?: string
  table?: string
}

export type PendingQueryExecution = QueryExecutionBase & {
  status: "pending"
}

export type SuccessQueryExecution<Row = object> = QueryExecutionBase & {
  status: "success"
  finishedAt: EpochMillis
  rowCount: number
  insertCount?: number
  rows: Row[]                           // always populated; [] for empty result
}

export type FailedQueryExecution = QueryExecutionBase & {
  status: "error"
  finishedAt: EpochMillis
  error: string
  errorStack?: string
}

export type CancelledQueryExecution = QueryExecutionBase & {
  status: "cancelled"
  finishedAt: EpochMillis
}

export type QueryExecution<Row = object> =
  | PendingQueryExecution
  | SuccessQueryExecution<Row>
  | FailedQueryExecution
  | CancelledQueryExecution
```

Every read of a `QueryExecution` loads `rows` if the status is `"success"`.
There is no summary variant — `rows: Row[]` on the success arm is always
populated (possibly to `[]`).

Memory is bounded at the access boundary, not at the type level:

- State holds only a small sliding window of recent executions (see
  `recentHistoryLimit`, §6.6).
- Older executions are loaded on demand via `queries.getById` or
  `queries.listPage`.

Connection/saved-query snapshots are stored on every execution so that
history stays readable after the source row is deleted (see §11.2).
`connectionId` is optional because the live FK is set to null when the
source connection is deleted; the snapshots remain the source of truth
for display.

Lifecycle: inserted with `status: "pending"` before the executor runs,
updated exactly once into one of `success`, `error`, or `cancelled`.
Status is monotonic (pending → terminal). No execution is inserted twice
under the same id.

#### Flows

A flow is an `audit_events` row with `kind: "flow.<name>"`. No separate
reified type:

```ts
export type QueryFlowAuditEvent =
  Extract<AuditEvent, { kind: `flow.${string}` }>
```

Runner methods open and close flows; precise signatures live with the
runner and are expected to evolve. Queries that run inside a flow carry
`parentAuditId` pointing at the flow event's id.

#### `SQL`

`SQL<Row>`, `Identifier`, `Paginated<Params, Row>`. SQL templates are opaque
to the engine core; adapters render them via `renderSQL(sql)`. `unsafeRawSQL<Row>(text)`
wraps hand-written query text with the row phantom type.

#### Async state is not a domain type

TanStack Query caches and observers are not domain nouns. They stay inside
`engine/services/` and `engine/workspace/` as implementation details. The
public engine state exposes a small engine-owned async shape
(`api/AsyncState.ts`) rather than TanStack Query's internal cache types.
Domain types model completed business facts (`Connection`,
`QueryExecution`, `SavedQuery`, `AuditEvent`), not the mechanics of
loading or subscribing to them.

### 3.7 `SavedQuery`

```ts
export type SavedQueryId = Id<"SavedQuery">;

export type SavedQuery = {
  id: SavedQueryId;
  name: string;
  text: string;
  protocol?: Protocol;
  createdAt: EpochMillis;
  updatedAt?: EpochMillis;
};
```

Saved queries are user-authored SQL snippets with a name and optional
protocol hint (used to resolve a compatible connection on restore).

### 3.8 `AuditEvent`

Discriminated union keyed by `kind`. Durable, mostly append-only, with
mutable `endedAt` and `cancelled` for flow-like events.

```ts
export type AuditEventId = Id<"AuditEvent">;

export type AuditEventBase = {
  id: AuditEventId;
  sessionId: SessionId;
  initiator: QueryInitiator;
  createdAt: EpochMillis;
  endedAt?: EpochMillis; // flow events only
  cancelled?: boolean; // flow events only
  parentAuditId?: AuditEventId; // nested flows / events under a flow
};

export type AuditEvent =
  | (AuditEventBase & { kind: "session.started"; payload: { app: string } })
  | (AuditEventBase & { kind: "session.ended"; payload: {} })
  | (AuditEventBase & {
      kind: "connection.created";
      connectionId: ConnectionId;
      payload: { name: string; protocol: Protocol };
    })
  | (AuditEventBase & {
      kind: "connection.updated";
      connectionId: ConnectionId;
      payload: {
        before: Partial<ConnectionSnapshot>;
        after: Partial<ConnectionSnapshot>;
      };
    })
  | (AuditEventBase & {
      kind: "connection.deleted";
      connectionId: ConnectionId;
      payload: { name: string; protocol: Protocol };
    })
  | (AuditEventBase & {
      kind: "connection.selected";
      connectionId?: ConnectionId;
      payload: { previous?: ConnectionId };
    })
  | (AuditEventBase & {
      kind: "saved_query.created";
      savedQueryId: SavedQueryId;
      payload: { name: string; protocol?: Protocol };
    })
  | (AuditEventBase & {
      kind: "saved_query.updated";
      savedQueryId: SavedQueryId;
      payload: { before: Partial<SavedQuery>; after: Partial<SavedQuery> };
    })
  | (AuditEventBase & {
      kind: "saved_query.deleted";
      savedQueryId: SavedQueryId;
      payload: { name: string };
    })
  | (AuditEventBase & {
      kind: "app_state.changed";
      payload: { id: AppStateKey; before?: Json; after: Json };
    })
  | (AuditEventBase & {
      kind: `flow.${string}`;
      connectionId: ConnectionId;
      payload: { name: string };
    });
```

Rules:

- Only `flow.*` events have meaningful `endedAt` and `cancelled`. All other
  kinds leave them null; they are written once and never updated.
- Flow events are updated exactly once, on `closeFlow`. After that they are
  treated as immutable.
- `parentAuditId` is set only when a flow opens inside another flow, or when
  a point-in-time event occurs inside a flow (rare; typically left null).
- `query_executions` are not in the audit log. Queries are their own
  first-class table. `audit_events` connects to them via
  `queryExecutionId` for events that reference a specific query.
- Payloads are typed per-kind and JSON-serializable.

### 3.9 `Catalog`

**`ObjectInfo`** — discoverable database objects (tables, views, indexes).
Structure is adapter-dependent but always includes identity plus display
metadata. Cached per-connection in the engine, never persisted.

**`Explain`** — `ExplainInput`, `ExplainResult` — adapter-provided analysis
output for editor feedback.

### 3.10 `Editor`

Existing editor domain types (buffer, completion, analysis, text ranges,
state) unchanged in structure. The `editor/index.ts` barrel is removed;
call sites import from explicit files.

---

## 4. Storage Schema

All persistent state lives in a single SQLite database managed by Drizzle.
The schema is defined in `engine/storage/schema/` and assembled in
`engine/storage/schema.ts`. The schema itself is platform-neutral; only
the driver that opens the connection is platform-specific.

### 4.1 `schema.ts` assembly

```ts
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { appState } from "./schema/appState";
import { auditEvents } from "./schema/auditEvents";
import { connections } from "./schema/connections";
import { queryExecutions } from "./schema/queryExecutions";
import { savedQueries } from "./schema/savedQueries";
import { sessions } from "./schema/sessions";

export const storageSchema = {
  appState,
  auditEvents,
  connections,
  queryExecutions,
  savedQueries,
  sessions,
} as const;

export type StorageSchema = typeof storageSchema;
export type StorageDb = BaseSQLiteDatabase<"async", unknown, StorageSchema>;
```

`StorageDb` is fixed to async (`"async"`) because every currently-planned
driver (libsql, sqlite-wasm over OPFS) is async. A sync variant would be a
separate type alias.

### 4.2 Column helpers (`schema/shared.ts`)

```ts
epochMillis(name: string) → integer column typed as EpochMillis
jsonText<T extends Json>(name: string) → text column in json mode typed as T
idColumn<Tag extends string>(name: string) → text column typed as Id<Tag>
```

### 4.3 Tables

#### `sessions`

| Column       | Type                      | Notes             |
| ------------ | ------------------------- | ----------------- |
| `id`         | `text, PK, Id<"Session">` |                   |
| `app`        | `text NOT NULL`           | host app name     |
| `created_at` | `integer NOT NULL`        | EpochMillis       |
| `ended_at`   | `integer`                 | null while active |

Indexes: `(created_at)`.

#### `connections`

| Column       | Type                       | Notes                 |
| ------------ | -------------------------- | --------------------- |
| `id`         | `text, PK, ConnectionId`   |                       |
| `name`       | `text NOT NULL`            |                       |
| `protocol`   | `text NOT NULL`            | `Protocol`            |
| `config`     | `text NOT NULL, json mode` | adapter-defined shape |
| `created_at` | `integer NOT NULL`         |                       |
| `updated_at` | `integer`                  |                       |

Indexes: `(created_at)`, `(protocol)`, `(name)`.

#### `saved_queries`

| Column       | Type                     | Notes              |
| ------------ | ------------------------ | ------------------ |
| `id`         | `text, PK, SavedQueryId` |                    |
| `name`       | `text NOT NULL`          |                    |
| `text`       | `text NOT NULL`          | SQL source         |
| `protocol`   | `text`                   | `Protocol \| null` |
| `created_at` | `integer NOT NULL`       |                    |
| `updated_at` | `integer`                |                    |

Indexes: `(created_at)`, `(protocol)`.

#### `app_state`

| Column       | Type                       | Notes         |
| ------------ | -------------------------- | ------------- |
| `app`        | `text NOT NULL`            | app namespace |
| `id`         | `text NOT NULL`            | `AppStateKey` |
| `value`      | `text NOT NULL, json mode` | `Json`        |
| `created_at` | `integer NOT NULL`         |               |
| `updated_at` | `integer`                  |               |

Primary key: composite `(app, id)`.
Indexes: `(app, created_at)`.

#### `query_executions`

| Column                         | Type                             | Notes                                                                          |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------ |
| `id`                           | `text, PK, QueryExecutionId`     |                                                                                |
| `session_id`                   | `text NOT NULL, SessionId`       | hard FK → `sessions.id`                                                        |
| `connection_id`                | `text, ConnectionId`             | `ON DELETE SET NULL`; nullable after source row is deleted                     |
| `connection_name_snapshot`     | `text NOT NULL`                  | captured at insert; survives connection deletion                               |
| `connection_protocol_snapshot` | `text NOT NULL`                  | captured at insert                                                             |
| `saved_query_id`               | `text, SavedQueryId`             | `ON DELETE SET NULL`; null for ad-hoc queries or when saved query was deleted  |
| `saved_query_name_snapshot`    | `text`                           | captured at insert when `saved_query_id` was set                               |
| `parent_audit_id`              | `text, AuditEventId`             | no FK (see §11.2); null for top-level queries                                  |
| `initiator`                    | `text NOT NULL`                  | `"user" \| "system"`                                                           |
| `created_at`                   | `integer NOT NULL`               |                                                                                |
| `updated_at`                   | `integer`                        |                                                                                |
| `finished_at`                  | `integer`                        | null while pending                                                             |
| `database`                     | `text`                           |                                                                                |
| `schema`                       | `text`                           |                                                                                |
| `table`                        | `text`                           |                                                                                |
| `sql_source`                   | `text NOT NULL`                  | rendered SQL text                                                              |
| `sql_args`                     | `text NOT NULL, json mode`       | `Json[]`                                                                       |
| `sensitive`                    | `integer NOT NULL, boolean mode` | default `false`                                                                |
| `status`                       | `text NOT NULL`                  | `"pending" \| "success" \| "error" \| "cancelled"`                             |
| `row_count`                    | `integer`                        | null while pending; set on success                                             |
| `insert_count`                 | `integer`                        | set on success when applicable                                                 |
| `error`                        | `text`                           | set on error                                                                   |
| `error_stack`                  | `text`                           | set on error                                                                   |
| `result_data`                  | `text, json mode`                | JSON-encoded rows on success; null otherwise                                   |

Indexes: `(session_id)`, `(connection_id)`, `(saved_query_id)`, `(parent_audit_id)`, `(created_at)`, `(status)`.

Every read loads `result_data`. No summary-vs-detail split at the storage
or service level.

The snapshot columns (`connection_*_snapshot`, `saved_query_name_snapshot`)
are written at execution insert. They are the source of truth for history
UIs once the live FK is nulled by a delete.

#### `audit_events`

| Column               | Type                       | Notes                              |
| -------------------- | -------------------------- | ---------------------------------- |
| `id`                 | `text, PK, AuditEventId`   |                                    |
| `session_id`         | `text NOT NULL, SessionId` | hard FK → `sessions.id`            |
| `created_at`         | `integer NOT NULL`         | event start                        |
| `ended_at`           | `integer`                  | flow events only                   |
| `cancelled`          | `integer, boolean mode`    | flow events only                   |
| `kind`               | `text NOT NULL`            |                                    |
| `initiator`          | `text NOT NULL`            |                                    |
| `parent_audit_id`    | `text, AuditEventId`       | nested flows / events under a flow |
| `subject_type`       | `text`                     | free-form subject tag              |
| `subject_id`         | `text`                     | id of the subject                  |
| `connection_id`      | `text, ConnectionId`       | reference-by-id only               |
| `saved_query_id`     | `text, SavedQueryId`       | reference-by-id only               |
| `query_execution_id` | `text, QueryExecutionId`   | reference-by-id only               |
| `payload`            | `text NOT NULL, json mode` | kind-specific tail                 |

Indexes: `(session_id)`, `(kind)`, `(created_at)`, `(parent_audit_id)`,
`(connection_id)`, `(saved_query_id)`, `(query_execution_id)`.

Only `session_id` is a DB-level FK on `audit_events`. Subject reference
columns (`connection_id`, `saved_query_id`, `query_execution_id`,
`parent_audit_id`) are branded-id text columns with no FK constraint —
indexed for filter queries but unconstrained by the database so audit
writes never fail because a subject row was deleted concurrently.
Dangling subject references are allowed; the audit log is the historical
record of what happened, not a live consistency check. Read-side code
treats any subject id as "may or may not still exist." Sessions are never
deleted, so `session_id` gets the stronger guarantee.

#### `saved_queries_fts` (FTS5 virtual table)

Full-text index backing `SavedQueriesApi.search`. External-content
mode with `content='saved_queries'` and `content_rowid='rowid'`:
`saved_queries` holds the row data; the FTS table stores only tokenized
index pages over `name` and `text`.

Synchronization triggers on `saved_queries`:

- `AFTER INSERT` → `INSERT INTO saved_queries_fts(rowid, name, text)`
- `AFTER UPDATE` → `INSERT INTO saved_queries_fts(saved_queries_fts, rowid, name, text) VALUES ('delete', …)` for the old values, then insert new values
- `AFTER DELETE` → same `('delete', …)` pattern

Queries use `MATCH` and order by `rank`. FTS5 table definitions and
triggers are raw-SQL migrations managed alongside the Drizzle schema
push — `pushSQLiteSchema` handles the regular tables; virtual tables
and triggers run as a paired migration step at boot.

#### `query_executions_fts` (FTS5 virtual table)

Full-text index backing `QueriesApi.search`. External-content mode with
`content='query_executions'` and `content_rowid='rowid'`. Indexed
columns: `sql_source`, `connection_name_snapshot`,
`saved_query_name_snapshot`, `database`, `schema`, `table`.

Synchronization triggers on `query_executions` for insert, update
(including the `SET NULL` sweeps on connection/saved-query deletion,
which update the snapshot-adjacent columns), and delete. Same
external-content pattern as `saved_queries_fts`.

Queries use `MATCH` and order by `rank` (or `bm25(query_executions_fts)`
for custom weighting later). The service layer joins FTS results back to
`query_executions` by rowid to return fully-loaded `QueryExecution`
objects.

### 4.4 Transaction rules

- Every mutation that affects multiple rows (state row + audit event)
  executes inside `db.transaction(async tx => …)`. Services never
  interleave a write with a non-transactional audit append.
- Single-row mutations with no corresponding audit event run without an
  explicit transaction.
- Flow open: one insert. Flow close: one update. No transaction needed for
  either.
- Query execution writes: `recordPending` is a single insert; `recordFinished`
  and `recordFailed` are single updates. No transactions needed.
- Audit events are inserted inside the transaction that wrote their subject
  row. They are never inserted retroactively.
- FTS5 index maintenance is handled by triggers on `saved_queries` and
  `query_executions`. Services do not write to the FTS tables directly.

### 4.5 JSON usage

JSON-typed columns: `connections.config`, `app_state.value`,
`query_executions.sql_args`, `query_executions.result_data`, `audit_events.payload`.

All other columns are first-class typed. There is no generic `json` bag on
any row.

---

## 5. In-Memory Store Graph

The engine's in-memory layer is a TanStack Store graph.

- `WorkspaceStore` owns one writable root store plus shared TanStack
  `Derived` stores.
- Hosts usually read through selectors; not every projection becomes a named
  derived store.
- Services mutate authoritative state through `workspace.setState(...)`.
- Services never write derived state.

### 5.1 `AsyncState<T>`

The public engine state uses a small engine-owned async wrapper:

```ts
export type AsyncState<T> = {
  status: "idle" | "pending" | "success" | "error";
  data?: T;
  error?: Error;
  updatedAt?: EpochMillis;
};
```

Rules:

- `data` may remain populated while a refresh is pending or after an error.
- This shape is intentionally smaller than TanStack Query's `QueryState`.
- If a service uses TanStack Query internally, observer results are bridged
  into `AsyncState<T>` with explicit `workspace.setState(...)` writes. No
  code depends on `queryClient.getQueryState(...)` being reactive.

### 5.2 `SqlVisorState`

```ts
export type SqlVisorState = {
  sessionId: SessionId;
  connections: AsyncState<Connection[]>;
  connectionSuggestions: AsyncState<DiscoveredConnectionSuggestion[]>;
  selectedConnectionId?: ConnectionId;
  selectedQueryExecutionId: QueryExecutionId | null;
  selectedQueryExecution: AsyncState<QueryExecution | null>;
  editor: EditorState;
  recentHistory: QueryExecution[]; // bounded sliding window; see §6.6
  savedQueries: SavedQuery[];
  appState: AppStateSnapshot;
  objectsByConnectionId: Record<ConnectionId, AsyncState<ObjectInfo[]>>;
};
```

`selectedConnectionId` is pure in-memory state — it is not persisted by
the engine. Hosts that want "remember the last connection across runs"
store it in `app_state` and call `sqlv.connections.select(id)` after the
engine is up.

`selectedQueryExecution` is source state, not derived state. The selected
execution may live outside `recentHistory`, so the engine keeps the loaded
resource for the current selection explicitly.

`recentHistory` is a bounded window (default 10 executions). It never
grows unbounded at runtime: on a new execution, the oldest is dropped.
On boot, only the most recent N rows are loaded. Older history is
reachable through `queries.listPage`, `queries.getById`, and
`queries.search`.

This is the single public state shape exposed through the `sqlv.state`
store plus the `sqlv.getState()` and `sqlv.subscribe(listener)`
convenience methods.

### 5.3 `WorkspaceStore`

`engine/workspace/WorkspaceStore.ts` is the engine-local state boundary.
It wraps the TanStack root store and owns the engine's shared derived
stores.

```ts
class WorkspaceStore {
  readonly state: ReadonlyStore<SqlVisorState>;
  readonly selectedConnection: Derived<Connection | undefined>;
  readonly selectedConnectionObjects: Derived<ObjectInfo[] | undefined>;
  readonly editorProtocol: Derived<Protocol | undefined>;

  constructor(initial: SqlVisorState);
  getState(): SqlVisorState;
  subscribe(listener: () => void): () => void;
  setState(updater: (prev: SqlVisorState) => SqlVisorState): void;
}
```

Rules:

- Every service holds a reference to the same `WorkspaceStore`.
- `WorkspaceStore` is a thin wrapper. It does not introduce a second state
  model, a normalization pass, or a `patch(...)` / `replace(...)` DSL.
- The underlying TanStack store still owns the authoritative source state;
  `WorkspaceStore` just keeps that mechanism localized to engine code.
- Shared derived values are created once here instead of being recreated ad
  hoc across services and hosts.

### 5.4 Derived state

Shared computed state lives in TanStack `Derived` stores owned by
`WorkspaceStore`.

Examples of canonical shared derived state:

- `selectedConnection` — resolve from `connections.data` and
  `selectedConnectionId`
- `selectedConnectionObjects` — resolve the selected connection's catalog
  slice from `objectsByConnectionId`
- `editorProtocol` — resolve from the selected connection and saved-query
  context
- `canRunQuery` — editor has non-empty text and a selected connection exists

Rules:

- Use `Derived` only for shared, canonical computed values that multiple
  engine consumers need.
- Use selectors at the host boundary for view-local projections.
- Derived stores depend only on TanStack Store nodes, never on imperative
  snapshot getters such as `queryClient.getQueryState(...)`.

### 5.5 Slice ownership

Each source-state slice is owned by exactly one service. Services may read
peers' slices through `WorkspaceStore` but never write them.

| Slice                                                                   | Owner                                  |
| ----------------------------------------------------------------------- | -------------------------------------- |
| `sessionId`                                                             | `SessionsService` (write-once at boot) |
| `connections`, `connectionSuggestions`, `selectedConnectionId`          | `ConnectionsService`                   |
| `objectsByConnectionId`                                                 | `CatalogService`                       |
| `recentHistory`, `selectedQueryExecutionId`, `selectedQueryExecution`   | `QueriesService`                       |
| `savedQueries`                                                          | `SavedQueriesService`                  |
| `appState`                                                              | `AppStateService`                      |
| `editor.*`                                                              | `EditorService`                        |

---

## 6. Services

All services live in `src/engine/services/`. Each file exports the service
class; its world-public interface is defined under `src/api/` and
`implements`'d by the class. Extra methods on the class are module-public
(visible to peer services) but absent from the public api type.

Every service constructor receives:

```ts
{
  db: StorageDb
  workspace: WorkspaceStore
  audit: AuditService
  ...typed peer services as needed
}
```

### 6.1 `SessionsService`

Owns session lifecycle. Module-public only (no public api).

- `start(app: string): Promise<Session>` — insert new session row, emit
  `session.started` audit event, write to `state.sessionId`.
- `end(): Promise<void>` — update `sessions.ended_at`, emit `session.ended`.

### 6.2 `AuditService`

Owns the audit log. Public api `AuditApi` is read-only:

```ts
export type AuditApi = {
  list(query?: AuditListQuery): Promise<AuditEvent[]>;
};

export type AuditListQuery = {
  sessionId?: SessionId;
  kinds?: AuditEventKind[];
  connectionId?: ConnectionId;
  savedQueryId?: SavedQueryId;
  queryExecutionId?: QueryExecutionId;
  since?: EpochMillis;
  until?: EpochMillis;
  limit?: number;
};
```

Module-public methods used by other services:

- `append(db: StorageDb, event: AuditEventInput): Promise<AuditEvent>`
- `closeFlow(db: StorageDb, auditId: AuditEventId, patch: { cancelled?: boolean }): Promise<void>`

`db` may be the root `StorageDb` or a transaction handle; Drizzle's type
accepts both.

### 6.3 `AdaptersService`

Owns the protocol → adapter map.

Public api `AdaptersApi`:

```ts
export type AdaptersApi = {
  listProtocols(): Array<{ protocol: Protocol; label: string }>;
  getSpec(protocol: Protocol): ConnectionSpec | undefined;
  describeConfig(protocol: Protocol, config: unknown): string;
};
```

Module-public methods:

- `get(protocol: Protocol): Adapter` — throws if unregistered
- `has(protocol: Protocol): boolean`
- `list(): Adapter[]` — used by connection-suggestion discovery

Constructor takes `Adapter[]`; registration is one-shot at engine boot.

### 6.4 `ConnectionsService`

Owns connections list, selection, and the per-connection `QueryRunnerImpl`
cache.

Public api `ConnectionsApi`:

```ts
export type ConnectionsApi = {
  list(): Promise<Connection[]>;
  add<P extends Protocol>(
    input: AddConnectionInput<P>,
  ): Promise<ConnectionOf<P>>;
  update<P extends Protocol>(
    connection: ConnectionOf<P>,
    patch: { name?: string; config?: Partial<ConfigFor<P>> },
  ): Promise<ConnectionOf<P>>;
  delete(id: ConnectionId): Promise<void>;
  select(id: ConnectionId | undefined): void;
  refreshSuggestions(): Promise<DiscoveredConnectionSuggestion[]>;
};
```

The `add<P>` generic lets TypeScript infer the protocol literal from the
caller's argument, so `add({ protocol: "postgres", name, config: {…} })`
gives back a `ConnectionOf<"postgres">` with a fully-typed config. The
same inference rejects a config that doesn't match the declared protocol.

`update<P>` takes the already-narrowed `ConnectionOf<P>` record (obtained
from `list()` or `getById()`) rather than a bare id. That forces the
caller to have narrowed by protocol before calling update, which in turn
makes the config patch's `P` honest: TypeScript infers `P` from the
connection argument and type-checks `config` against `ConfigFor<P>`. The
service additionally verifies at runtime that the stored row's protocol
still matches `connection.protocol` (defense against stale state) and
throws if it doesn't.

Module-public:

- `getRunner(id: ConnectionId): Promise<QueryRunnerImpl<Protocol>>` — lazily
  creates, caches, and returns an audited runner for the connection. The
  return type is protocol-erased; callers that need the config-typed
  shape cast using the connection's narrowed protocol (see §11.6).
- `requireConnection(id: ConnectionId): Connection` — synchronous lookup
  against in-memory state; throws on unknown id. Returns the full
  discriminated union; callers narrow by `protocol` when they need the
  config.
- `loadInitial(): Promise<void>` — hydrates state from storage at boot.
- `evictRunner(id: ConnectionId): void` — called internally on delete to
  cancel outstanding queries and drop the cached runner.

Collaborators: `AdaptersService`, `AuditService`, `WorkspaceStore`.

Side effects of `add`:

1. Insert row + emit `connection.created` audit event (one transaction).
2. One `workspace.setState(...)` update replaces `state.connections` and
   sets `state.selectedConnectionId` to the new connection.

Side effects of `delete`:

1. Cancel all queries on the connection's runner.
2. Evict runner from cache.
3. Delete row + emit `connection.deleted` audit event (one transaction).
4. One `workspace.setState(...)` update replaces `state.connections`; if
   the deleted connection was selected, resolve a new selection via
   `#resolveSelectedConnectionId`.

Selection resolution when the current id is invalid (e.g., after a delete):

1. First connection by `createdAt` descending.
2. `undefined`.

The engine does not persist selection and has no "last used" fallback.
If a host wants to restore the last-selected connection across restarts,
it writes the id into `app_state` and calls `sqlv.connections.select(id)`
after boot. That is host policy and the engine does not participate.

### 6.5 `CatalogService`

Owns per-connection object caches (no durable storage). May use TanStack
Query internally for fetch deduplication and abort, but any observable
engine state is bridged into `WorkspaceStore` through explicit
`workspace.setState(...)` writes.

Public api `CatalogApi`:

```ts
export type CatalogApi = {
  load(connectionId: ConnectionId): Promise<ObjectInfo[]>;
  getForConnection(connectionId: ConnectionId): ObjectInfo[] | undefined;
};
```

Module-public:

- `invalidate(connectionId: ConnectionId): void` — drop cached objects for
  a connection; called by `ConnectionsService.delete`.

`load` opens a flow (`flow.load_objects`) via the connection's runner and
issues `adapter.fetchObjects(runner.withFlow(flow))`. The flow closes in a
`finally` block with `cancelled` matching the abort state.

### 6.6 `QueriesService`

Owns the currently-selected query, execution dispatch, and a bounded
in-memory window of recent executions.

Public api `QueriesApi`:

```ts
export type QueriesApi = {
  run(input?: RunQueryInput): QueryRef
  getById(id: QueryExecutionId): Promise<QueryExecution | undefined>
  listRecent(): QueryExecution[]                         // bounded window from state
  listPage(query: HistoryPageQuery): Promise<QueryExecution[]>
  search(text: string, options?: HistorySearchOptions): Promise<QueryExecution[]>
  select(id: QueryExecutionId | null): void
  cancel(ref: QueryRef): void
  cancelAll(): void
}

export type RunQueryInput = {
  text?: string
  connectionId?: ConnectionId
}

export type HistoryPageQuery = {
  limit: number                                          // hard cap per call
  before?: EpochMillis                                   // paginate by createdAt desc
  connectionId?: ConnectionId                            // optional filter
}

export type HistorySearchOptions = {
  limit?: number                                         // default 50
  connectionId?: ConnectionId
}
```

Module-public (called by `QueryRunnerImpl`):

- `recordPending(execution: PendingQueryExecution): Promise<PendingQueryExecution>` — insert row
- `recordFinished<Row>(id: QueryExecutionId, patch: QueryExecutionFinishPatch<Row>): Promise<SuccessQueryExecution<Row>>` — transition pending → success
- `recordFailed(id: QueryExecutionId, patch: QueryExecutionFailPatch): Promise<FailedQueryExecution>` — transition pending → error
- `recordCancelled(id: QueryExecutionId): Promise<CancelledQueryExecution>` — transition pending → cancelled
- `loadInitial(): Promise<void>` — hydrate `state.recentHistory` with the most recent `recentHistoryLimit` executions (fully loaded)

#### `recentHistoryLimit`

Construction option, default `10`:

```ts
SqlVisor.create({ …, recentHistoryLimit: 10 })
createBunSqlVisor({ …, recentHistoryLimit: 10 })
```

On boot, `QueriesService.loadInitial()` loads the `recentHistoryLimit`
most recent executions by `createdAt` descending. On every subsequent
`run` completion, the new execution is prepended to `state.recentHistory`
and the oldest is dropped if the window is full.

Hosts that want to browse older history call `listPage` or `search`.
Neither touches `state.recentHistory`; they query storage and return
detached result arrays.

#### `run` semantics

1. Resolve `text` (defaults to `state.editor.buffer.text`) and
   `connectionId` (defaults to `state.selectedConnectionId`).
2. Validate non-empty + connection-exists.
3. Build a pending `QueryExecution` and publish it with one
   `workspace.setState(...)` update to `state.recentHistory` (with window
   eviction), `state.selectedQueryExecution`, and
   `state.selectedQueryExecutionId`.
4. Dispatch through `ConnectionsService.getRunner(id).execute(sql, options)`.
5. On resolve/reject: one `workspace.setState(...)` replaces the pending
   slot in `state.recentHistory` with the terminal record and updates
   `state.selectedQueryExecution` if it is still the selected row.

#### `listPage`

Paginated storage read. Orders by `createdAt` DESC. `before` acts as a
cursor: pass the oldest returned `createdAt` on the previous page. Each
returned `QueryExecution` is fully hydrated (success arm carries rows).

#### `search`

Storage-backed fuzzy text search over query history, backed by a
SQLite FTS5 virtual table (`query_executions_fts`, see §4.3). Indexed
columns: `sql_source`, `connection_name_snapshot`,
`saved_query_name_snapshot`, `database`, `schema`, `table`. Triggers on
`query_executions` keep the FTS index in sync with inserts, updates, and
`SET NULL` sweeps.

Search input is passed to FTS5's match syntax (tokenized prefix by
default). Results are ordered by FTS relevance (`rank`) and hydrated
into full `QueryExecution` objects via the primary table, capped by
`options.limit` (default 50).

#### `getById`

Loads a single execution with full data, regardless of whether it's in
the recent window.

### 6.7 `SavedQueriesService`

Public api `SavedQueriesApi`:

```ts
export type SavedQueriesApi = {
  list(): SavedQuery[];
  saveAsNew(input: SaveQueryAsNewInput): Promise<SavedQuery>;
  saveChanges(
    id: SavedQueryId,
    input: SaveSavedQueryChangesInput,
  ): Promise<SavedQuery>;
  delete(id: SavedQueryId): Promise<void>;
  findLatestExecution(id: SavedQueryId): QueryExecution | undefined;
  search(text: string, options?: { limit?: number }): Promise<SavedQuery[]>;
};
```

Module-public: `loadInitial()`.

Saved-query mutations emit `saved_query.created/updated/deleted` audit
events in the same transaction as the row write.

`search` is storage-backed fuzzy text search over `name` and `text`,
backed by a SQLite FTS5 virtual table (`saved_queries_fts`, see §4.3).
Triggers keep the index in sync with inserts, updates, and deletes. It
is not limited to `state.savedQueries` — it queries the full table.
Results are ordered by FTS relevance and returned as hydrated
`SavedQuery[]`.

### 6.8 `AppStateService`

App state is host-written opaque JSON that the engine persists and
retrieves without interpreting. The types (`AppStateKey`, `AppStateRow`,
`AppStateSnapshot`, `AppStateApi`) live in `api/AppStateApi.ts` — they
are engine-provided storage with no domain semantics.

```ts
// api/AppStateApi.ts
export type AppStateKey = string  // plain string; host-defined at runtime

export type AppStateRow<Value extends Json = Json> = {
  app: string
  id: AppStateKey
  value: Value
  createdAt: EpochMillis
  updatedAt?: EpochMillis
}

export type AppStateSnapshot = Record<AppStateKey, Json>

export type AppStateApi = {
  get<Value extends Json = Json>(id: AppStateKey): Value | undefined
  getOrDefault<Value extends Json>(id: AppStateKey, fallback: Value): Value
  update<Value extends JsonObject>(
    id: AppStateKey,
    patch: Partial<Value>,
    fallback: Value,
  ): Promise<Value>
  replace<Value extends Json>(id: AppStateKey, value: Value): Promise<Value>
}
```

Module-public: `loadInitial()`.

Primary key is composite `(app, id)`. All reads and writes are scoped to
the current session's `app`. The service never sees rows from other apps.

The engine itself reads no app state. Anything that looks like "restore
UI state across sessions" — last-selected connection, last-opened saved
query, editor pane sizes — is host policy and lives here.

Each write emits an `app_state.changed` audit event in the same
transaction.

### 6.9 `EditorService`

Owns all editor state (`editor.buffer`, `editor.completion`, `editor.analysis`,
`editor.completionScopeMode`, `editor.savedQueryId`, `editor.treeSitterGrammar`).
Completion fan-out and analysis dispatch are internal collaborators, not
separate services.

Public api `EditorApi`:

```ts
export type EditorApi = {
  setBuffer(
    patch: EditorBufferPatch & { savedQueryId?: SavedQueryId | null },
  ): void;
  applyChange(change: EditorChange): void;
  formatQuery(): boolean;
  openCompletion(context: EditorCompletionContext): void;
  closeCompletion(): void;
  focusCompletionItem(input: EditorCompletionItemFocusInput): void;
  applyCompletionItem(ref?: EditorCompletionItemRef): boolean;
  requestAnalysis(parentAuditId?: AuditEventId): void;
  cancelAnalysis(): void;
};
```

Internal collaborators:

- `CompletionController` — owns `SuggestionProvider[]` fan-out and the abort
  lifecycle for in-flight completion requests. Takes `CatalogService` +
  `ConnectionsService` for suggestion context.
- `AnalysisController` — owns adapter explain dispatch and abort lifecycle.
  Takes `ConnectionsService` for the active runner, `AdaptersService` for
  adapter capability checks.

Neither controller is exposed on the aggregate or any api type.

---

## 7. `QueryRunnerImpl`

`engine/runtime/QueryRunnerImpl.ts` is the only path from an adapter to the
database. It wraps an `Executor` with the engine's auditing and cancellation
discipline.

`QueryRunnerImpl<P extends Protocol>` implements the SPI's
`QueryRunner<ConfigFor<P>>`. It takes a `Session`, a `ConnectionOf<P>`,
an `Executor`, and module-public handles on `QueriesService`,
`AuditService`, and `StorageDb`. Exact method signatures live with the
runner source and are expected to evolve; the stable parts are:

- `execute(sql, options)` runs a user- or system-initiated query through
  the executor and records it via `QueriesService`.
- `query(sql, options)` is a thin wrapper that returns rows only.
- `iterate(paginated, params, options)` paginates inside a flow.
- Flow management (open, close, `withFlow`) creates or references a
  `QueryFlowAuditEvent` — the durable audit row is the handle.

The cache in `ConnectionsService` stores runners as the protocol-erased
`QueryRunnerImpl<Protocol>`. Adapter dispatch sites narrow via the
connection's `protocol` discriminant and cast once (see §11.6).

Responsibilities:

- **Persistence.** Every call to `execute` writes a pending
  `query_executions` row before the executor runs and updates it on
  terminal status. The runner is the _only_ writer of this table.
- **Flows.** Opening a flow inserts an `audit_events` row with
  `kind: "flow.<name>"`, `created_at: now`, `ended_at: null`. Closing the
  flow updates `ended_at` and `cancelled`. Sibling runners bound to a
  flow set `query_executions.parent_audit_id` on every subsequent execute.
- **Cancellation.** A shared `Set<AbortController>` across the runner and
  its flow-bound siblings. `cancelAll()` aborts every outstanding
  controller.
- **Isolation from adapters.** Adapter code receives the runner (never the
  raw executor, never `StorageDb`). Any SQL the adapter runs goes through
  the runner's methods, so every adapter-driven query is auto-logged
  without requiring adapter cooperation.

Failure modes throw `QueryExecutionError` carrying the final
`FailedQueryExecution` or `CancelledQueryExecution` snapshot. Callers use
the snapshot for UI even on failure. Success calls return a
`SuccessQueryExecution<Row>` with `rows` populated.

---

## 8. Public API

### 8.1 `SqlVisor` aggregate

```ts
// api/SqlVisor.ts

export type SqlVisor = {
  readonly session: Session;
  readonly state: ReadonlyStore<SqlVisorState>;
  readonly adapters: AdaptersApi;
  readonly audit: AuditApi;
  readonly connections: ConnectionsApi;
  readonly catalog: CatalogApi;
  readonly queries: QueriesApi;
  readonly savedQueries: SavedQueriesApi;
  readonly appState: AppStateApi;
  readonly editor: EditorApi;

  subscribe(listener: () => void): () => void;
  getState(): SqlVisorState;
};
```

`state` is the public readonly TanStack Store handle for hosts that want
selector-based subscriptions. It is forwarded from the internal
`WorkspaceStore`. `subscribe` and `getState` remain convenience delegates
for non-React or low-friction callers.

### 8.2 `*Api` types

Every `*Api` type lives in `src/api/`. The engine service class implements
the api type. Additional module-public methods on the class are absent
from the api type — so the TypeScript compiler prevents apps from calling
them.

```
src/api/
  SqlVisor.ts
  SqlVisorState.ts
  AsyncState.ts
  AdaptersApi.ts
  AuditApi.ts
  ConnectionsApi.ts
  CatalogApi.ts
  QueriesApi.ts
  SavedQueriesApi.ts
  AppStateApi.ts
  EditorApi.ts
  init.ts
```

No `api/services/` subfolder. The files are peers.

`AsyncState.ts` exports the public async resource shape used by
`SqlVisorState`. It is intentionally smaller than TanStack Query's
`QueryState`. Shared `Derived` stores and any TanStack Query bridge code
live under `engine/workspace/` and are not part of the public surface.

### 8.3 Visibility enforcement

```ts
// engine/services/ConnectionsService.ts
import type { ConnectionsApi } from "#api/ConnectionsApi"

export class ConnectionsService implements ConnectionsApi {
  async list(): Promise<Connection[]> { … }
  async add<P extends Protocol>(input: AddConnectionInput<P>): Promise<ConnectionOf<P>> { … }
  async update<P extends Protocol>(
    connection: ConnectionOf<P>,
    patch: { name?: string; config?: Partial<ConfigFor<P>> },
  ): Promise<ConnectionOf<P>> { … }
  async delete(id: ConnectionId): Promise<void> { … }
  select(id: ConnectionId | undefined): void { … }
  async refreshSuggestions(): Promise<DiscoveredConnectionSuggestion[]> { … }
  // module-public — not on ConnectionsApi
  async getRunner(id: ConnectionId): Promise<QueryRunnerImpl<Protocol>> { … }
  requireConnection(id: ConnectionId): Connection { … }
  async loadInitial(): Promise<void> { … }
  evictRunner(id: ConnectionId): void { … }
}
```

The `SqlVisor` implementation declares its public fields at the api type:

```ts
// engine/SqlVisor.ts
import type { SqlVisor as SqlVisorApi } from "#api/SqlVisor";

export class SqlVisor implements SqlVisorApi {
  readonly state: ReadonlyStore<SqlVisorState>;
  readonly connections: ConnectionsApi;
  readonly queries: QueriesApi;
  readonly audit: AuditApi;
  // …
  #services: {
    workspace: WorkspaceStore;
    connections: ConnectionsService;
    queries: QueriesService;
    audit: AuditService;
    // …
  };

  private constructor(services) {
    this.#services = services;
    this.state = services.workspace.state;
    this.connections = services.connections; // widens to ConnectionsApi
    this.queries = services.queries;
    // …
  }
}
```

Services hold references to each other at the _full_ class type, so they
can call module-public methods. The aggregate hands apps a narrower view of
the same objects and forwards `workspace.state` as its public store handle.

### 8.4 `api/init.ts`

Minimal convenience entrypoint that delegates to a platform factory chosen
by the host at build time. Typical host code:

```ts
import { createSqlVisor } from "sqlv"; // api/init.ts
const sqlv = await createSqlVisor({ app: "tui" });
```

---

## 9. Platform Composition

### 9.1 Layout (Bun)

```
src/platforms/bun/
  createBunSqlVisor.ts
  paths.ts
  storage/
    openLibsqlDb.ts
    libsqlClient.ts
    secrets.ts
```

### 9.2 `openLibsqlDb`

The single boot seam for libsql-backed storage.

```ts
export async function openLibsqlDb(args: {
  app?: string;
  dbPath?: string;
  encryptionKey?: string;
  secrets?: SecretStore;
  allowDestructiveMigration?: boolean;
}): Promise<{
  db: StorageDb;
  close: () => void;
  dbPath: string;
  migration: StorageMigration;
}>;
```

Responsibilities:

1. Resolve the DB path (default: `${XDG_DATA_HOME}/sqlv/${app}.db`).
2. Resolve or create the encryption key via `Bun.secrets`.
3. Create the libsql client and validate the key by reading `sqlite_master`.
4. Enable `PRAGMA foreign_keys = ON`.
5. Build the Drizzle instance against `storageSchema`.
6. Run `pushSQLiteSchema(storageSchema, db)`; if the diff is destructive
   and `allowDestructiveMigration` is false, throw `StorageMigrationError`.
7. Apply FTS5 virtual tables and their synchronization triggers via an
   idempotent raw-SQL migration step (`CREATE VIRTUAL TABLE IF NOT EXISTS`
   + `CREATE TRIGGER IF NOT EXISTS`). These sit outside Drizzle's schema
   push because `drizzle-kit` does not model FTS5 virtual tables.
8. Return the handle.

Session creation does _not_ live here — that is the engine's
`SessionsService.start()` job. `openLibsqlDb` returns only storage.

### 9.3 `createBunSqlVisor`

Composition root for the Bun host.

```ts
export async function createBunSqlVisor(options: {
  app?: string;
  adapters?: Adapter[];
  dbPath?: string;
  encryptionKey?: string;
  secrets?: SecretStore;
  queryClient?: QueryClient;
  suggestionProviders?: SuggestionProvider[];
  allowDestructiveMigration?: boolean;
}): Promise<SqlVisor>;
```

Behavior:

1. `openLibsqlDb(...)` → `{ db, close }`.
2. Instantiate built-in adapters (`TursoAdapter`, `BunSqlAdapter`,
   `PostgresAdapter`) and merge with `options.adapters`.
3. `SqlVisor.create({ db, app, adapters, queryClient, suggestionProviders, close })`.
4. Return the engine.


### 9.4 Platform-specific surface

Only platform code touches:

- `@libsql/client` (Bun, Node)
- `sqlite-wasm` / OPFS (browser)
- `Bun.secrets` (Bun) or WebCrypto + IndexedDB (browser)
- `XDG_DATA_HOME` / AppData resolution
- `drizzle-kit/api`'s `pushSQLiteSchema` (all local platforms; a remote
  platform would migrate server-side instead)

Engine, api, spi, domain, adapters never import any of the above.

---

## 10. Audit Model

### 10.1 Append-only with monotonic flow mutation

`audit_events` is append-only except for flow events, which receive exactly
one update (`ended_at` null → set). After close, flow rows are immutable.
No audit event row is ever deleted.

### 10.2 Event kinds

```
session.started                  point-in-time
session.ended                    point-in-time
connection.created               point-in-time
connection.updated               point-in-time
connection.deleted               point-in-time
connection.selected              point-in-time
saved_query.created              point-in-time
saved_query.updated              point-in-time
saved_query.deleted              point-in-time
app_state.changed                point-in-time
flow.<name>                      span (opens + later closes)
```

### 10.3 Flow event naming

The `<name>` portion of `flow.<name>` is the value supplied to
`openFlow({ name })`. Built-in names used by the engine today:

- `flow.load_objects` — `CatalogService.load`
- `flow.editor_explain` — `EditorService.requestAnalysis`
- `flow.iterate` — `QueryRunnerImpl.iterate` pagination

Adapters may open flows with arbitrary names; the convention is
`<adapter>.<operation>` (e.g., `flow.sample.table`).

### 10.4 Transactional coupling

Every state mutation that has a corresponding audit event writes both in
one transaction. The service guarantees the write ordering: subject row
first, audit event second, but within the same transaction either both
land or neither does.

Queries are intentionally _not_ in the audit log. The `query_executions`
table is the durable record. The audit log provides context around a
query via `parent_audit_id` on the flow that spawned it.

### 10.5 Read surface

`AuditApi.list(query)` supports filtering by session, kind, subject FK,
and time range. Results are ordered by `created_at` ascending. No
pagination cursor — `limit` is an absolute cap. Consumers that need
streaming pagination use `since` on the next call.

---

## 11. Invariants & Contracts

### 11.1 Identity

- All branded IDs are UUIDv4 strings.
- An id is assigned at row creation and never changes.
- A flow's identity is the `AuditEventId` of its opening
  `kind: "flow.<name>"` row. There is no separate flow id.

### 11.2 Referential integrity

Two kinds of reference columns exist:

- **Hard DB-level FKs** — enforced by SQLite when
  `PRAGMA foreign_keys = ON`. Deletions of the target fail, or cascade,
  per the column's declared action.
- **Soft reference columns** — branded-id text columns with no FK
  constraint, indexed for filtering. Dangling references are allowed and
  expected; the application treats them as "may or may not still exist."

`query_executions`:

| Column            | Relationship                                    | On delete of target   |
| ----------------- | ----------------------------------------------- | --------------------- |
| `session_id`      | hard FK → `sessions.id`                         | RESTRICT (not deleted) |
| `connection_id`   | hard FK → `connections.id`, nullable            | `SET NULL`            |
| `saved_query_id`  | hard FK → `saved_queries.id`, nullable          | `SET NULL`            |
| `parent_audit_id` | soft reference → `audit_events.id`              | n/a (audit not deleted) |

When a connection is deleted, existing `query_executions.connection_id`
rows become `NULL`. The snapshot columns
(`connection_name_snapshot`, `connection_protocol_snapshot`) remain
populated so history UIs read cleanly after deletion. The same is true
for `saved_query_id` and its `saved_query_name_snapshot`.

`audit_events`:

| Column               | Relationship                                  |
| -------------------- | --------------------------------------------- |
| `session_id`         | hard FK → `sessions.id` (RESTRICT)            |
| `parent_audit_id`    | soft reference — self                         |
| `connection_id`      | soft reference                                |
| `saved_query_id`     | soft reference                                |
| `query_execution_id` | soft reference                                |

Subject reference columns (connection/saved-query/query-execution) are
unconstrained by the database. Dangling references are allowed and
expected:

1. Audit writes must never fail because a subject row was deleted in a
   concurrent transaction.
2. The audit log is a historical record of what happened. A
   `connection.deleted` event carries the `connection_id` of the row
   that was just deleted — an FK would make that row impossible to
   insert.
3. Historical events preserve their subject id: a `connection.created`
   event from months ago still points at its (now-deleted) `connection_id`.

`session_id` is the exception: sessions are never deleted, so a dangling
`session_id` on an audit event is corruption rather than expected state.
The DB-level FK ensures it can't happen.

Indexes on those columns support efficient filter queries without
committing to referential enforcement.

Other tables (`connections`, `saved_queries`, `app_state`, `sessions`)
have no outgoing FKs.

### 11.3 Mutability

- `sessions`: `ended_at` set-once.
- `connections`, `saved_queries`, `app_state`: `updated_at` set on mutation;
  all fields other than `id`/`created_at` are mutable.
- `query_executions`: `status`, `finished_at`, `updated_at`, `result_data`,
  `row_count`, `insert_count`, `error`, `error_stack` transition from
  null/pending to their terminal values exactly once. The
  `connection_id` and `saved_query_id` columns are also mutated by
  `SET NULL` from external deletes; their snapshot columns are immutable.
- `audit_events`: only `ended_at` and `cancelled` are mutated, and only on
  flow-kind rows exactly once at `closeFlow`.

### 11.4 Cancellation

- All async work runs under an `AbortSignal`.
- `QueryRunnerImpl` holds a shared controller set with its `withFlow`
  siblings; `cancelAll` aborts every outstanding one.
- `ConnectionsService.delete` calls `cancelAll` on the connection's runner
  before deleting.
- `QueriesService.cancel(ref)` aborts the TanStack query for that
  execution; the runner's catch path writes a `cancelled` status row.

### 11.5 State discipline

- `WorkspaceStore` is the engine's in-memory authority. It owns the root
  TanStack store plus the engine's shared `Derived` stores.
- Services access peer state through `workspace.getState()`; they never
  reach into other services' fields.
- Services mutate source state through `workspace.setState(...)`; they
  never keep a parallel writable snapshot.
- Shared computed state lives in `WorkspaceStore`'s `Derived` stores and is
  never written directly.
- Persistence and state updates for a given operation run in this order:
  1. Start transaction.
  2. Write row + write audit event.
  3. Commit.
  4. Perform one `workspace.setState(...)` update for the new authoritative
     in-memory state.
- If a service uses TanStack Query internally, query observers feed store
  updates explicitly; no code relies on `queryClient.getQueryState(...)`
  being reactive.
- On transaction failure, state is _not_ patched and the caller sees the
  error. Callers do not retry automatically.

### 11.6 Adapter discipline

- Adapters receive only `QueryRunner<Config>`, never `Executor` or
  `StorageDb`. The runner is typed at the adapter's own `Config` so
  `fetchObjects(runner)`, `explain(runner, input)`, and
  `sample(ident, runner)` see the correct config shape.
- Adapters never call `db.insert` or `db.update` on the storage schema.
- Every adapter-initiated SQL goes through `runner.execute` /
  `runner.query` / `runner.iterate`, which writes the auditable
  `query_executions` row automatically.
- Adapters open flows via `runner.openFlow` for multi-query operations;
  the runner handles close in finally blocks, so adapter code doesn't need
  to guarantee close on error.

#### Runner-to-adapter dispatch

The engine's runner cache stores runners as the protocol-erased
`QueryRunnerImpl<Protocol>` because the cache key is only `ConnectionId`.
When an engine service needs to pass a runner into a specific adapter
(`CatalogService.load`, editor analysis, sample), it narrows the
connection's protocol and casts the runner at that call site:

```ts
const connection = this.connections.requireConnection(id); // Connection
const adapter = this.adapters.get(connection.protocol); // RegisteredAdapter<P>
const runner = await this.connections.getRunner(id); // QueryRunnerImpl<Protocol>
await adapter.fetchObjects(
  runner as QueryRunner<ConfigFor<typeof connection.protocol>>,
);
```

The cast is sound because `ConnectionsService.add` validates the
connection's config against its protocol on creation, so at runtime the
adapter and runner always share the same `Config`. The cast is the only
`as` in engine dispatch; it exists because TypeScript cannot express the
cross-row "adapter protocol === connection protocol" invariant without
dependent types.

### 11.7 Result payloads

- `query_executions.result_data` is always loaded on read. `getById`,
  `listRecent`, `listPage`, and `search` all hydrate `rows` on
  `SuccessQueryExecution`.
- Memory is bounded by the access boundary, not by the data model:
  `state.recentHistory` is capped at `recentHistoryLimit` (default 10);
  `listPage` and `search` enforce per-call limits; `getById` is a single
  row. The engine never loads the full `query_executions` table at once.
- The engine never truncates, samples, or summarizes `result_data` on
  write. Payloads of several MB are acceptable.
- `result_data` for non-`success` statuses is `NULL` in storage and
  omitted from the domain type (the `rows` field is only present on
  `SuccessQueryExecution<Row>`).

---

## 12. File Layout Reference

```
src/
  api/
    AdaptersApi.ts
    AppStateApi.ts
    AsyncState.ts
    AuditApi.ts
    CatalogApi.ts
    ConnectionsApi.ts
    EditorApi.ts
    QueriesApi.ts
    SavedQueriesApi.ts
    SqlVisor.ts
    SqlVisorState.ts
    init.ts

  domain/
    primitive/
      EpochMillis.ts
      Id.ts
      Json.ts
      Protocol.ts
    util/
      Result.ts
      defer.ts
      errors.ts
      unreachable.ts
    connection/
      Connection.ts
    session/
      Session.ts
    query/
      QueryExecution.ts
      SQL.ts
      formatQuery.ts
    savedQuery/
      SavedQuery.ts
    appState/
      AppState.ts
    audit/
      AuditEvent.ts
    catalog/
      Explain.ts
      ObjectInfo.ts
    editor/
      analysis.ts
      buffer.ts
      completion.ts
      state.ts
      suggestionMenu.ts
      text.ts

  spi/
    Adapter.ts
    Executor.ts
    QueryRunner.ts
    SuggestionProvider.ts

  engine/
    SqlVisor.ts
    storage/
      schema.ts
      schema/
        appState.ts
        auditEvents.ts
        connections.ts
        queryExecutions.ts
        savedQueries.ts
        sessions.ts
        shared.ts
    workspace/
      WorkspaceStore.ts
    services/
      AdaptersService.ts
      AppStateService.ts
      AuditService.ts
      CatalogService.ts
      ConnectionsService.ts
      EditorService.ts
      QueriesService.ts
      SavedQueriesService.ts
      SessionsService.ts
    runtime/
      QueryRunnerImpl.ts
    suggestions/
      KnownObjectsSuggestionProvider.ts

  adapters/
    sqlite/
      sqliteIntrospection.ts
      sqliteExplain.ts
      bun/
        BunSqliteAdapter.ts
      turso/
        TursoAdapter.ts
    postgres/
      postgresIntrospection.ts
      postgresExplain.ts
      node/
        PgAdapter.ts

  platforms/
    bun/
      createBunSqlVisor.ts
      paths.ts
      storage/
        libsqlClient.ts
        openLibsqlDb.ts
        secrets.ts

  apps/
    framework/
      focus/
      commands/
      workspace/
    tui/
      framework/
      features/
      app/
```
