# SqlVisor Engine Design

This document records the target architecture for `sqlv`.

It is intentionally:

- not a migration plan
- not a line-by-line implementation checklist
- not a dump of every method signature

It is the concise spec for boundaries, canonical types, storage shape, and
engine invariants.

---

## 1. Goals

`sqlv` is a reusable SQL engine with multiple hosts. The TUI is one host, not
the architecture.

Design goals, in order:

1. **Policy / mechanism separation.** The engine owns product behavior.
   Platforms own concrete runtime wiring.
2. **One canonical model per concept.** No row-store envelopes, no "same thing
   but for this layer" mirrors unless there is a real boundary.
3. **Platform-neutral engine.** Today that means Bun + libsql. The engine,
   schema, services, and API should stay portable to other async SQLite-backed
   platforms later.
4. **Simple public contracts.** Public types live in `src/api/`. Domain types
   model durable facts, not loading mechanics.
5. **Durable local history.** Queries are first-class durable records.
   Everything else writes to an append-only audit log.

---

## 2. Layers

| Layer             | Imports                                | Role                                           |
| ----------------- | -------------------------------------- | ---------------------------------------------- |
| `domain/`         | nothing                                | Pure domain types and helpers                  |
| `spi/`            | `domain`                               | Adapter extension contracts                    |
| `api/`            | `domain`, `spi`                        | Public engine contracts                        |
| `engine/`         | `domain`, `spi`, `api` (type-only)     | Orchestration, state, services, storage schema |
| `adapters/`       | `domain`, `spi`, sibling adapter files | Protocol implementations                       |
| `platforms/`      | `domain`, `spi`, `api`, `engine`       | Concrete runtime wiring                        |
| `apps/framework/` | `api`, `domain`                        | Shared host framework code                     |
| `apps/*`          | `api`, `domain`, `apps/framework`      | Concrete hosts                                 |

Rules:

- `domain/` stays free of engine, storage, TUI, and runtime concerns.
- `adapters/` do not import `engine/`, `platforms/`, or `apps/`.
- `apps/` do not import `engine/` or platform internals.
- `engine/`, `api/`, `domain/`, and `spi/` do not import libsql,
  `drizzle-kit`, filesystem APIs, or host code.
- Composition roots live in platform entrypoints such as
  `platforms/bun/createBunSqlVisor.ts`.

One plausible file layout sketch:

```text
src/
  api/
  domain/
  spi/
  engine/
    runtime/
    services/
    storage/
      migrations/
    workspace/
  adapters/
  platforms/
    bun/
  apps/
```

---

## 3. Core Types

### 3.1 Primitives

Core primitives live in `src/domain/primitive/`:

- `EpochMillis`
- `Id<Tag>`
- `Json`
- `Protocol`

`Protocol` is backed by declaration merging through `ProtocolToConfig`, so the
domain owns the protocol-to-config mapping and adapters extend it.

```ts
export interface ProtocolToConfig extends Record<string, Json> {}
export type Protocol = Extract<keyof ProtocolToConfig, string>;
export type ConfigFor<P extends Protocol> = ProtocolToConfig[P];
```

### 3.2 Connection

`Connection` is a discriminated union keyed by `protocol`.

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
```

Rules:

- no generic row envelope
- no `type` discriminator
- no per-protocol tables
- `protocol` is immutable after creation
- `config` must be JSON-safe and consistent with `protocol`

Historical and audit payloads use a JSON-safe snapshot, not the live typed
config union:

```ts
export type ConnectionSnapshot = {
  id: ConnectionId;
  name: string;
  protocol: Protocol;
  config: Json;
  createdAt: EpochMillis;
  updatedAt?: EpochMillis;
};
```

### 3.3 Session

```ts
export type SessionId = Id<"Session">;

export type Session = {
  id: SessionId;
  app: string;
  createdAt: EpochMillis;
  endedAt?: EpochMillis;
};
```

A session is one run of a host application. Sessions start at engine boot and
end at engine disposal.

### 3.4 QueryExecution

`QueryExecution` is the single model for active query, recent history, and
loaded historical detail.

```ts
export type QueryExecutionId = Id<"QueryExecution">;
export type QueryInitiator = "user" | "system";
export type QueryRef = { queryId: QueryExecutionId };

type QueryExecutionBase = {
  id: QueryExecutionId;
  sessionId: SessionId;
  connectionId?: ConnectionId;
  connectionNameSnapshot: string;
  connectionProtocolSnapshot: Protocol;
  savedQueryId?: SavedQueryId;
  savedQueryNameSnapshot?: string;
  parentAuditId?: AuditEventId;
  initiator: QueryInitiator;
  createdAt: EpochMillis;
  updatedAt?: EpochMillis;
  sql: { source: string; args: Json[] };
  sensitive: boolean;
  database?: string;
  schema?: string;
  table?: string;
};

export type PendingQueryExecution = QueryExecutionBase & {
  status: "pending";
};

export type SuccessQueryExecution<Row = object> = QueryExecutionBase & {
  status: "success";
  finishedAt: EpochMillis;
  rowCount: number;
  insertCount?: number;
  rows: Row[];
};

export type FailedQueryExecution = QueryExecutionBase & {
  status: "error";
  finishedAt: EpochMillis;
  error: string;
  errorStack?: string;
};

export type CancelledQueryExecution = QueryExecutionBase & {
  status: "cancelled";
  finishedAt: EpochMillis;
};

export type QueryExecution<Row = object> =
  | PendingQueryExecution
  | SuccessQueryExecution<Row>
  | FailedQueryExecution
  | CancelledQueryExecution;
```

Rules:

- every durable query run has exactly one `QueryExecutionId`
- status is monotonic: `pending -> success | error | cancelled`
- success rows always carry `rows`
- failed and cancelled rows do not
- snapshots make history readable after connection or saved-query deletion

### 3.5 SavedQuery

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

### 3.6 AuditEvent

`AuditEvent` is a durable, mostly append-only log row keyed by `kind`.

The important distinction is:

- point-in-time events are immutable
- flow events (`kind: "flow.<name>"`) get one closing update

Core shape:

```ts
export type AuditEventId = Id<"AuditEvent">;

export type AuditEventBase = {
  id: AuditEventId;
  sessionId: SessionId;
  initiator: QueryInitiator;
  createdAt: EpochMillis;
  endedAt?: EpochMillis;
  cancelled?: boolean;
  parentAuditId?: AuditEventId;
};
```

Concrete event kinds are listed in the audit section below.

### 3.7 SQL, Editor, and Async State

- SQL templates and identifiers remain domain types.
- Existing editor domain types stay in `src/domain/editor/`.
- Async loading state is **not** a domain type. It belongs in `src/api/`.

---

## 4. Storage

All durable state lives in a single SQLite database managed through Drizzle.

The schema lives under `src/engine/storage/schema/`. Platform code opens the
driver and runs migrations; engine code owns the schema itself.

```ts
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

export type StorageSchema = typeof storageSchema;
export type StorageDb = BaseSQLiteDatabase<"async", unknown, StorageSchema>;
```

`StorageDb` is intentionally async-only. If a sync backend is ever added, it
should be a separate type and explicit design decision.

### 4.1 Schema Helpers

SQLite stores branded ids and timestamps as ordinary text and integer columns.
The branding is a TypeScript concern, so schema helpers should make that
relationship explicit.

One plausible `schema/shared.ts` shape:

```ts
import { integer, text } from "drizzle-orm/sqlite-core";

export function idColumn<T extends Id<string>>(name: string) {
  return text(name).$type<T>();
}

export function epochMillis(name: string) {
  return integer(name, { mode: "number" }).$type<EpochMillis>();
}

export function jsonText<T extends Json>(name: string) {
  return text(name, { mode: "json" }).$type<T>();
}
```

Example table definitions:

```ts
import type { SessionId } from "#domain/Session";

export const sessions = sqliteTable("sessions", {
  id: idColumn<SessionId>("id").primaryKey(),
  app: text("app").notNull(),
  createdAt: epochMillis("created_at").notNull(),
  endedAt: epochMillis("ended_at"),
});

export const queryExecutions = sqliteTable("query_executions", {
  id: idColumn<QueryExecutionId>("id").primaryKey(),
  sessionId: idColumn<SessionId>("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "restrict" }),
  connectionId: idColumn<ConnectionId>("connection_id").references(
    () => connections.id,
    { onDelete: "set null" },
  ),
  parentAuditId: idColumn<AuditEventId>("parent_audit_id"),
  createdAt: epochMillis("created_at").notNull(),
  finishedAt: epochMillis("finished_at"),
  sqlArgs: jsonText<Json[]>("sql_args").notNull(),
  resultData: jsonText<Json[]>("result_data"),
});
```

This gives us three useful properties:

- Drizzle rows carry branded ids and timestamps at the type level
- the physical SQLite representation stays boring and transparent
- engine code can map Drizzle rows to domain objects immediately without
  carrying untyped storage shapes through state

Schema files may export `$inferSelect` / `$inferInsert` row types for local
storage code, but those types should not become long-lived engine state.

### 4.2 Schema Map

The canonical Drizzle-managed schema should be explicit:

```ts
export const storageSchema = {
  sessions,
  connections,
  savedQueries,
  appState,
  queryExecutions,
  auditEvents,
} as const;
```

That is the full map of engine-owned Drizzle tables.

Expected tables:

- `sessions`
  - `id`
  - `app`
  - `createdAt`
  - `endedAt`
- `connections`
  - `id`
  - `name`
  - `protocol`
  - `config`
  - `createdAt`
  - `updatedAt`
- `savedQueries`
  - `id`
  - `name`
  - `text`
  - `protocol`
  - `createdAt`
  - `updatedAt`
- `appState`
  - `app`
  - `id`
  - `value`
  - `createdAt`
  - `updatedAt`
  - primary key: `(app, id)`
- `queryExecutions`
  - `id`
  - `sessionId`
  - `connectionId`
  - `connectionNameSnapshot`
  - `connectionProtocolSnapshot`
  - `savedQueryId`
  - `savedQueryNameSnapshot`
  - `parentAuditId`
  - `initiator`
  - `createdAt`
  - `updatedAt`
  - `finishedAt`
  - `database`
  - `schema`
  - `table`
  - `sqlSource`
  - `sqlArgs`
  - `sensitive`
  - `status`
  - `rowCount`
  - `insertCount`
  - `error`
  - `errorStack`
  - `resultData`
- `auditEvents`
  - `id`
  - `sessionId`
  - `createdAt`
  - `endedAt`
  - `cancelled`
  - `kind`
  - `initiator`
  - `parentAuditId`
  - `subjectType`
  - `subjectId`
  - `connectionId`
  - `savedQueryId`
  - `queryExecutionId`
  - `payload`

### 4.3 Migration Strategy

We want:

- schema declarations in TypeScript
- generated SQL migration files checked into the repo
- runtime boot that applies pending migrations
- one migration stream that can include manual SQL for FTS5

So the storage model is:

- `src/engine/storage/schema/`
  - canonical Drizzle table declarations
- one committed SQLite migration directory, e.g.
  `src/engine/storage/migrations/`
  - Drizzle-generated SQL migrations for ordinary schema changes
  - manual SQL migrations for FTS5 tables, triggers, and similar SQLite
    features that are outside Drizzle's schema model

Runtime boot applies pending migrations from that directory in order. It does
not diff the live database against the TypeScript schema at startup.

This is the intended balance:

- TypeScript schema stays authoritative for normal relational structure
- runtime migration application is deterministic and versioned
- FTS5 lives in the same migration stream instead of a special boot-only path

### 4.4 Auxiliary SQL Objects

The full storage design is slightly larger than the Drizzle table map.

Auxiliary SQL-managed objects:

- `saved_queries_fts`
- `query_executions_fts`
- the triggers that keep those FTS tables in sync

These should be treated as first-class parts of the schema design even though
they are not represented in the Drizzle `storageSchema` object. They live in
manual SQL migrations beside the generated migrations.

### 4.5 JSON Columns

JSON is used where flexibility matters:

- `connections.config`
- `app_state.value`
- `query_executions.sql_args`
- `query_executions.result_data`
- `audit_events.payload`

Everything else is first-class typed columns.

### 4.6 Reference Strategy

There are two kinds of references:

- **Hard FKs** for live relational state that must stay consistent
- **Soft references** for historical links that may outlive the target row

Concretely:

- `query_executions.session_id` is a hard FK
- `query_executions.connection_id` and `saved_query_id` are nullable hard FKs
  with `ON DELETE SET NULL`
- `query_executions.parent_audit_id` is a soft reference
- `audit_events.session_id` is a hard FK
- other `audit_events` subject refs are soft references

The important rule is that history remains readable after deletion. Snapshot
columns on `query_executions` are the source of truth for display after the live
FK has been nulled.

### 4.7 Transaction Rule

If an operation writes both a state row and an audit event, it does so in one
transaction. Query execution rows are different: `QueryRunnerImpl` is the only
writer of `query_executions`, and its pending/terminal row writes stand on their
own.

---

## 5. In-Memory State

The engine owns one writable in-memory state tree backed by TanStack Store.

- source state is written once
- shared computed state uses derived stores
- hosts read through the public store, selectors, or convenience methods

### 5.1 AsyncState

The public async wrapper is engine-owned and intentionally small:

```ts
export type AsyncState<T> = {
  status: "idle" | "pending" | "success" | "error";
  data?: T;
  error?: Error;
  updatedAt?: EpochMillis;
};
```

This is not TanStack Query state. It is the public shape that hosts consume.

### 5.2 SqlVisorState

```ts
export type SqlVisorState = {
  sessionId: SessionId;
  connections: AsyncState<Connection[]>;
  connectionSuggestions: AsyncState<DiscoveredConnectionSuggestion[]>;
  selectedConnectionId?: ConnectionId;
  selectedQueryExecutionId: QueryExecutionId | null;
  selectedQueryExecution: AsyncState<QueryExecution | null>;
  recentHistory: QueryExecution[];
  savedQueries: SavedQuery[];
  appState: AppStateSnapshot;
  editor: EditorState;
  objectsByConnectionId: Record<ConnectionId, AsyncState<ObjectInfo[]>>;
};
```

Important state rules:

- `selectedConnectionId` is in-memory only
- host-specific persistence like "last selected connection" belongs in
  `app_state`
- `recentHistory` is bounded
- the selected execution may live outside `recentHistory`, so it is tracked
  separately

### 5.3 WorkspaceStore

`WorkspaceStore` is the engine-local state boundary.

It owns:

- the single writable root store
- shared derived stores such as selected connection and selected objects
- `getState`, `subscribe`, and `setState`

It does **not** introduce a second state model or a custom mutation DSL.

---

## 6. Services

Services live in `src/engine/services/`. Each service owns one slice of durable
behavior and one slice of source state.

| Service               | Owns                                                      |
| --------------------- | --------------------------------------------------------- |
| `SessionsService`     | session lifecycle                                         |
| `AuditService`        | audit append + read                                       |
| `AdaptersService`     | adapter registry                                          |
| `ConnectionsService`  | connection CRUD, selection, runner cache                  |
| `CatalogService`      | per-connection object cache                               |
| `QueriesService`      | query dispatch, recent history, selection, search, paging |
| `SavedQueriesService` | saved-query CRUD and search                               |
| `AppStateService`     | opaque host state                                         |
| `EditorService`       | editor state, completion, analysis                        |

Common rules:

- public contracts live in `src/api/`
- services may expose extra peer-facing helpers, but hosts only see the API
  surface
- each source-state slice has one owning service
- services mutate state only through `WorkspaceStore`

### 6.1 Service Relationships

The expected dependency shape is mostly acyclic and layered:

- `SessionsService`, `AuditService`, and `AdaptersService` are foundational
- `ConnectionsService` depends on `AdaptersService`, `AuditService`,
  `WorkspaceStore`, and current session context
- `QueriesService` depends on `ConnectionsService` and `WorkspaceStore`
- `CatalogService` depends on `ConnectionsService` and `AdaptersService`
- `SavedQueriesService` depends on `AuditService` and `WorkspaceStore`
- `AppStateService` depends on `AuditService` and `WorkspaceStore`
- `EditorService` depends on `ConnectionsService`, `CatalogService`, and
  `AdaptersService`

Rules:

- peer dependencies should point toward narrower capabilities, not toward the
  whole aggregate
- `AuditService` should stay low in the graph; higher-level services write audit
  through it, but it does not depend on them
- `QueriesService` owns query history; other services may read it, but they do
  not write `query_executions`
- `ConnectionsService` owns runner lifecycle; other services ask it for runners
  rather than constructing their own
- `EditorService` and `CatalogService` should not become hidden persistence
  layers

Two relationships are especially important:

- `ConnectionsService -> QueryRunnerImpl`
  : runner creation and caching belong with live connections
- `QueryRunnerImpl -> QueriesService + AuditService`
  : all query persistence and flow wiring pass through one path

### 6.2 ConnectionsService

`ConnectionsService` owns:

- `connections`
- `selectedConnectionId`
- the per-connection `QueryRunnerImpl` cache

High-level behavior:

- add/update/delete connection rows
- emit matching audit events
- create and evict runners
- choose a fallback selection when the selected connection disappears

The engine does not persist connection selection. If a host wants to restore it
across sessions, it writes the id into `app_state` and re-selects after boot.

### 6.3 QueriesService

`QueriesService` owns:

- execution dispatch through runners
- `recentHistory`
- `selectedQueryExecutionId`
- `selectedQueryExecution`

Public behavior:

- run a query
- select a query execution
- cancel one or all queries
- list recent in-memory history
- page older durable history
- search durable history
- load a specific historical execution by id

Design choices:

- `recentHistory` is a small bounded window
- older history is storage-backed, not kept in memory forever
- history reads return full `QueryExecution` objects
- search is FTS-backed, but that detail stays below the public API

### 6.4 SavedQueriesService

Owns saved-query CRUD plus storage-backed search. Search is backed by FTS5, not
by filtering the in-memory array.

### 6.5 AppStateService

`AppStateService` persists host-written opaque JSON scoped by `app`.

This is engine-provided storage, not domain semantics. The engine stores and
retrieves it but does not interpret it.

The public types live in `src/api/AppStateApi.ts`:

```ts
export type AppStateKey = string;
export type AppStateSnapshot = Record<AppStateKey, Json>;
```

### 6.6 EditorService

Owns editor buffer, completion, analysis, and saved-query binding.

Completion and analysis helpers may have internal controllers, but they are
engine internals, not part of the public aggregate.

---

## 7. QueryRunnerImpl

`QueryRunnerImpl` is the only path from adapters to actual SQL execution.

It wraps an executor with engine policy:

- audited query persistence
- flow creation and closing
- cancellation
- error normalization

Rules:

- adapters receive a `QueryRunner`, never `StorageDb`
- adapters do not write the storage schema directly
- every adapter-initiated query goes through the runner
- the runner is the only writer of `query_executions`

`QueryRunnerImpl<P extends Protocol>` is typed against `ConfigFor<P>`. The
runner cache is protocol-erased by `ConnectionId`, so adapter dispatch sites do
one local cast after narrowing on `connection.protocol`.

---

## 8. Public API

The public API lives in `src/api/`.

Public state and service contracts belong there. Engine code may import those
types type-only in order to expose the narrower public surface.

The aggregate shape is intentionally small:

```ts
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
};
```

---

## 9. Platform Composition

The Bun composition root should stay small and explicit.

One plausible layout:

```text
src/platforms/bun/
  createBunSqlVisor.ts
  paths.ts
  storage/
    libsqlClient.ts
    openLibsqlDb.ts
    secrets.ts
```

### 9.1 openLibsqlDb

`openLibsqlDb` owns:

1. DB path resolution
2. encryption key resolution or creation
3. encrypted libsql client creation
4. key validation
5. `PRAGMA foreign_keys = ON`
6. Drizzle DB creation
7. applying pending migrations from the committed migration directory
8. returning the storage handle

It returns storage only. Session creation belongs to the engine.

### 9.2 createBunSqlVisor

`createBunSqlVisor` is the composition root that:

1. opens storage
2. assembles adapters
3. creates the engine
4. returns the public `SqlVisor`

Platform-only code touches:

- `@libsql/client`
- secrets
- filesystem path resolution
- the runtime Drizzle migrator
- migration-file loading / packaging

---

## 10. Audit Model

The audit log is append-only except for flow close.

Event families:

- `session.started`
- `session.ended`
- `connection.created`
- `connection.updated`
- `connection.deleted`
- `connection.selected`
- `saved_query.created`
- `saved_query.updated`
- `saved_query.deleted`
- `app_state.changed`
- `flow.<name>`

Rules:

- queries are **not** audit events; they live in `query_executions`
- flow identity is the opening audit row id
- `flow.<name>` rows get one terminal update (`endedAt`, optional
  `cancelled`)
- the audit log may refer to deleted subjects through soft references

---

## 11. Invariants

### 11.1 Identity

- all branded ids are immutable
- every query run has exactly one `QueryExecutionId`
- a flow has no separate id beyond its opening `AuditEventId`

### 11.2 Persistence

- `connections`, `saved_queries`, and `app_state` are mutable tables
- `query_executions` are append-then-complete records
- `audit_events` are append-only except for flow close

### 11.3 Referential Integrity

- live relational state uses hard FKs where deletion should be governed
- historical links use soft references where dangling refs are acceptable
- `query_executions` snapshot columns preserve display data after live refs are
  nulled
- `audit_events.session_id` is hard because sessions are never deleted

### 11.4 State Discipline

- `WorkspaceStore` is the single writable in-memory authority
- services never keep a parallel writable state snapshot
- shared computed state is derived, not hand-maintained
- storage writes happen before state publication

### 11.5 Adapter Discipline

- adapters never see `StorageDb`
- adapters never write engine storage directly
- every adapter-initiated query is routed through `QueryRunnerImpl`

### 11.6 Result Payloads

- successful query executions persist full `result_data`
- query reads return full `QueryExecution` objects
- in-memory retention is bounded by `recentHistory`, not by truncating results
- paging and search keep older history out of the always-hot state

---

## 12. Summary

The target shape is:

- domain types for durable facts
- API types for the public surface
- one engine-owned store graph
- one engine-owned SQLite schema
- one audited runner path for all SQL execution
- one public aggregate handed to hosts

That is the design to optimize for: fewer mirrors, fewer hidden layers, and a
clear split between engine policy and platform mechanism.
