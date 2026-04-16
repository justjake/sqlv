# Modules

This document is the authoritative module architecture for `sqlv`.

When code and this document disagree, clean the code toward this file rather
than preserving drift.

## Core Rules

- Keep policy separate from mechanism.
- Keep `SqlVisor` usable by multiple hosts, not just the TUI.
- Keep the engine platform-neutral; platforms own DB drivers, secrets,
  paths, and migration runners.
- Keep adapters isolated as public extension points.
- Keep host-owned preferences out of engine semantics; store them as opaque
  `app_state` rows.

## Top-Level Layout

```text
src/
  api/        - policy facade
  domain/     - semantics
  spi/        - contracts
  engine/     - policy
  platforms/  - mechanism
  adapters/   - mechanism
  apps/
    framework/      - mechanism
    */framework/    - mechanism
    */features/     - host policy
    */app/          - host policy
```

## Layer Responsibilities

### `api/`

Host-facing contracts and aggregate types.

Examples:

- `SqlVisor`
- `SqlVisorState`
- `AsyncState`
- `ConnectionsApi`
- `QueriesApi`

### `domain/`

Pure domain nouns and helpers.

Examples:

- `Connection`
- `Session`
- `SavedQuery`
- `QueryExecution`
- `AuditEvent`
- `ObjectInfo`
- `SQL`

No runtime orchestration. No platform details. No host policy.

### `spi/`

Public extension contracts implemented by adapters and plugins.

Examples:

- `Adapter`
- `Executor`
- `QueryRunner`
- `SuggestionProvider`

### `engine/`

Private platform-neutral orchestration.

Examples:

- `SqlVisor` implementation
- `QueryRunnerImpl`
- `WorkspaceStore`
- `engine/storage/schema.ts`
- `ConnectionsService`
- `QueriesService`
- `CatalogService`
- `SavedQueriesService`
- `AppStateService`

The engine owns the service graph, in-memory store graph, and storage
schema. It does **not** own runtime-specific DB opening, secret storage,
XDG/AppData resolution, or migration wiring.

The engine must not import Bun, libsql, `drizzle-kit`, filesystem/XDG APIs,
WebSocket, HTTP transport, or TUI code.

### `adapters/`

Built-in protocol implementations, treated as plugins.

Adapters may depend on:

- `domain/`
- `spi/`
- sibling files within their adapter family
- external driver libraries

Adapters must not import:

- `engine/*`
- `platforms/*`
- `apps/*`

### `platforms/`

Runtime-specific wiring and composition roots.

Examples:

- `platforms/bun/createBunSqlVisor.ts`
- `platforms/bun/storage/openLibsqlDb.ts`
- `platforms/browser/createBrowserSqlVisor.ts`

Platforms own:

- DB driver wiring
- secret storage
- OS path resolution
- schema push / migration runner wiring
- built-in adapter registration

### `apps/`

Concrete hosts built on the public API.

Examples:

- `apps/framework/*`
- `apps/tui/*`

Apps render state from `api/` and issue commands through `api/`. They do
not reach into `engine/` or `platforms/` internals directly, except by
calling platform entrypoints.

## Dependency Rules

Enforced by the `sqlv/layer-boundaries` oxlint rule in
[`src/tools/oxlint/rules/layer-boundaries.ts`](./src/tools/oxlint/rules/layer-boundaries.ts),
with shared layer metadata in
[`src/tools/oxlint/layers.ts`](./src/tools/oxlint/layers.ts). Keep this
file in sync with the rule. Run `bun run lint:fix` to autofix specifier
direction; run `bun run lint` to see remaining violations.

Allowed dependency flow:

```text
domain -> nothing

spi -> domain

api -> domain + spi + engine (types)
engine -> domain + spi + api (types)

adapters -> domain + spi + sibling adapter-family files + external libs
platforms -> domain + spi + engine + api + external libs

apps/framework -> api + domain + external libs
apps/* -> api + domain + apps/framework + external libs
```

Forbidden:

- `adapters` ↔ `engine`, `platforms`, `apps`
- `apps` → `engine`
- `apps` → `platforms` internals
- `platforms` → `apps`
- imports of `libsql`, `drizzle-kit`, or Node filesystem APIs from
  `engine/`, `api/`, `domain/`, or `spi/`

Import-style rules:

- same-layer imports use relative paths
- cross-layer imports use aliases

## Composition Roots

Only platform entrypoints should instantiate concrete wiring.

Examples:

- `platforms/bun/createBunSqlVisor.ts`
- `platforms/browser/createBrowserSqlVisor.ts`
- app bootstrap files that call those platform entrypoints

The platform-neutral engine factory may accept already-wired dependencies,
but hosts should not assemble engine internals themselves.

## Target Shape

```text
src/
  api/
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

  domain/
    primitive/
    util/
    connection/
    session/
    query/
    savedQuery/
    audit/
    catalog/
    editor/

  spi/
    Adapter.ts
    Executor.ts
    QueryRunner.ts
    SuggestionProvider.ts

  engine/
    QueryRunnerImpl.ts
    SqlVisor.ts
    storage/
      schema.ts
      schema/
    workspace/
      WorkspaceStore.ts
    services/

  platforms/
    bun/
      createBunSqlVisor.ts
      paths.ts
      storage/
        openLibsqlDb.ts
    browser/
      createBrowserSqlVisor.ts

  adapters/
    sqlite/
    postgres/

  apps/
    framework/
    tui/
```

## Storage and App State

The canonical design has two persisted-state buckets:

1. Durable core state owned by the engine
2. Host-owned `app_state` rows

Examples of durable core state:

- sessions
- connections
- saved queries
- query history
- audit events

Examples of host-owned app state:

- icon style
- pane sizes
- tree expansion state
- last-selected connection for a specific host

The engine persists `app_state` as opaque JSON scoped by `app`, but it does
not interpret that data. Anything that looks like "restore UI state across
sessions" is host policy.

No separate core settings layer is part of the canonical design.

The SQLite schema lives in `engine/storage/schema.ts` and
`engine/storage/schema/*`. It is platform-neutral. Platforms open concrete
DB connections and run schema push, FTS setup, and migration steps against
that shared engine-owned schema.

Do not use Drizzle table types as domain types.

## Storage Path Ownership

Preferred flow:

1. app bootstrap calls a platform factory
2. platform factory resolves the default storage location
3. platform storage code opens the DB at that path

Rules:

- `apps/tui` may pass `app: "tui"` and explicit overrides like `dbPath`
- `platforms/bun` owns XDG/AppData/Application Support resolution
- low-level storage code accepts a path but should not know what XDG is

For the default encrypted app DB, prefer an OS-native data directory, not a
config directory. On Unix-like systems this means `XDG_DATA_HOME`, not
`XDG_CONFIG_HOME`.

## When In Doubt

- keep domain concepts in `domain/`
- keep host-facing contracts in `api/`
- keep extension contracts in `spi/`
- keep orchestration and state discipline in `engine/`
- keep runtime-specific details in `platforms/`
- keep protocol implementations in `adapters/`
- keep app behavior and presentation in `apps/`
