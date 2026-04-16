# Modules

This document describes the **canonical module architecture** for `sqlv`.

The repo now mostly matches this layout. When code and this document disagree, treat this file as the intended direction and clean the code toward it rather than preserving the drift.

## Policy vs Mechanism

A core design rule in this repo is to keep **policy** separate from **mechanism**.

- **Policy** decides what the system should do: workflows, defaults, sequencing, selection, and user-facing behavior.
- **Mechanism** defines how those decisions are carried out: storage backends, transport, database drivers, rendering bindings, and other implementation details.

Following the Unix design tradition described in *The Art of Unix Programming*, we prefer simple, generic mechanisms and put product-specific choices in policy layers above them. Lower layers should provide capabilities, not make surprising decisions on behalf of higher layers.

## Goals

- Keep the `SqlVisor` engine usable by multiple hosts, not just the TUI.
- Keep the engine portable across platforms like Bun and browsers.
- Keep adapters isolated as public extension points.
- Keep app-specific concerns out of engine/core storage schemas.
- Make default wiring simple for built-in apps without leaking platform details upward.

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

## Module Responsibilities

### `api/`

Host-facing public API.

Examples:

- `SqlVisor`
- `AdapterRegistry`

This is what embedders call.

### `domain/`

Shared domain layer and pure helpers.

Examples:

- `Connection`
- `SavedQuery`
- `QueryExecution`
- `ObjectInfo`
- `SQL`

This layer contains nouns, not runtime orchestration.

If layer path aliases are introduced, prefer `#domain/*`.

### `spi/`

Public extension contracts.

Examples:

- `Adapter`
- `Executor`
- `QueryRunner`
- `SuggestionProvider` if suggestions remain extensible

This is what plugins/adapters implement.

### `engine/`

Private platform-neutral orchestration and state.

Examples:

- workspace snapshot/store
- app state and workspace selection persistence boundaries
- query service
- catalog service
- connection service
- saved query service
- settings service
- analysis/suggestion services
- internal dependency contracts in `engine/deps`

The engine should depend only on:

- `domain/`
- `spi/`
- `engine/deps`

The engine must not import Bun, sqlite/libsql, filesystem, XDG, WebSocket, HTTP transport, or TUI code.

### `platforms/`

Concrete runtime-specific implementation.

Examples:

- `platforms/bun/*`
- `platforms/browser/*`

This layer implements the dependencies required by `engine/`.

Examples:

- storage repositories
- app-state storage backend
- query runtime implementation
- local secret storage
- OS path resolution
- browser transport/storage shims

### `adapters/`

Built-in adapter implementations, treated as plugins.

Adapters are a public extension surface and should be isolated similarly to apps.

Examples:

- `adapters/sqlite/*`
- `adapters/postgres/*`

Adapters may depend on:

- `domain/`
- `spi/`
- sibling files within their adapter family
- external driver libraries

Adapters must not import:

- `engine/*`
- `platforms/*`
- `apps/*`

### `apps/`

Concrete hosts built on top of the public API.

Examples:

- `apps/framework/*`
- `apps/tui/*`

Apps may depend on:

- `api/`
- `domain/`
- shared app framework modules
- renderer/framework libraries

Apps must not import:

- `engine/*`
- `platforms/*` internals directly, except via platform creation entrypoints

## Target Shape

```text
src/
  api/
    SqlVisor.ts
    AdapterRegistry.ts
    init.ts

  domain/
    sql/
    connection/
    query/
    catalog/
    settings/
    shared/

  spi/
    Adapter.ts
    Executor.ts
    QueryRunner.ts
    SuggestionProvider.ts

  engine/
    deps/
      repositories.ts
      AppStateStore.ts
      QueryRuntime.ts
      AdapterLookup.ts
    workspace/
      WorkspaceSnapshot.ts
      WorkspaceStore.ts
    services/
      ConnectionsService.ts
      CatalogService.ts
      QueryService.ts
      SavedQueryService.ts
      SettingsService.ts
      SuggestionService.ts
      AnalysisService.ts
    glue/
      buildEngine.ts

  platforms/
    bun/
      createBunSqlVisor.ts
      paths.ts
      storage/
        drizzleClient.ts
        schema/
        migrations/
        repositories/
      runtime/
      local/
        secrets.ts
        discovery.ts
    browser/
      createBrowserSqlVisor.ts
      storage/
      transport/
      runtime/

  adapters/
    sqlite/
      sqliteIntrospection.ts
      sqliteExplain.ts
      bun/
        BunSqliteAdapter.ts
      turso/
        TursoAdapter.ts
      libsql/
        LibsqlAdapter.ts
    postgres/
      postgresIntrospection.ts
      postgresExplain.ts
      node/
        PgAdapter.ts

  apps/
    framework/
      focus/
      commands/
      workspace/
    tui/
      framework/
        focus/
        keybind/
        modal/
        theme/
      features/
      app/
```

## Dependency Rules

Enforced by the `sqlv/layer-boundaries` oxlint rule. The allowed flow below is
mirrored by the `ALLOWED` table in
[`src/tools/oxlint/layers.ts`](./src/tools/oxlint/layers.ts); keep them in sync.
Run `bun run lint:fix` to autofix same-layer/cross-layer specifier direction;
`bun run lint` to see remaining violations. See
[`src/tools/oxlint/README.md`](./src/tools/oxlint/README.md) for full details.

Allowed dependency flow:

```text
domain -> nothing

spi -> domain

engine/deps -> domain + spi
engine/workspace -> domain
engine/services -> domain + spi + engine/deps
engine/glue -> engine/* + domain + spi

platforms/* -> domain + spi + engine/deps + external libs

adapters/* -> domain + spi + sibling adapter-family files + external libs

api/* -> domain + spi + engine/*
platform creation entrypoints -> api + engine + platforms + adapters

apps/framework/* -> api + domain + external libs
apps/* -> api + domain + apps/framework + external libs
```

Forbidden sideways dependencies:

```text
adapters X platforms internals
adapters X engine
adapters X apps
apps X engine
apps X platforms internals
platforms X apps
```

The only code that should wire concrete things together is a composition root.

## Composition Roots

There should be a small number of places where concrete implementations are instantiated and wired together.

Examples:

- `engine/glue/buildEngine.ts`
- `platforms/bun/createBunSqlVisor.ts`
- `platforms/browser/createBrowserSqlVisor.ts`
- app bootstrap files

`buildEngine.ts` should assemble the engine from abstract dependencies.

`createBunSqlVisor.ts` should decide how Bun/local defaults are implemented.

## Host and Platform Separation

The engine must be isolated from any specific host and any specific runtime platform.

That means:

- the TUI is just one host under `apps/tui`
- a browser host should also be possible
- Bun/local storage is just one platform implementation
- browser transport/storage should be able to satisfy the same engine deps

The engine should be able to run:

- locally in Bun, with direct executors and local encrypted storage
- in a browser, with execution over HTTP and storage over WebSocket, MessagePort, IndexedDB, or similar

## Adapter Family Structure

Protocol families should keep shared introspection/explain logic together, while concrete adapters stay separate.

Example:

```text
adapters/
  sqlite/
    sqliteIntrospection.ts
    sqliteExplain.ts
    bun/
      BunSqliteAdapter.ts
    turso/
      TursoAdapter.ts
    libsql/
      LibsqlAdapter.ts
```

This keeps:

- family-shared logic inside the family
- public adapter contracts in `spi/`
- private engine/platform details out of adapters

## App-Specific State and Storage

There are three kinds of persisted state:

1. Core durable data
2. Core cross-host settings
3. App-owned preferences/workspace state

Examples:

- Core durable data: connections, saved queries, query history
- Core settings: only settings that are truly meaningful across hosts
- App state: icon style, pane sizes, tree expansion state, TUI-only selection memory

App-specific state must not be baked into engine-owned settings schemas.

For example, `icon_style: 'nerdfont' | 'unicode'` belongs to the TUI app, not to a core settings table.

The engine should expose app-bound state storage for the current app instance.

Example direction:

```ts
const sqlv = await createBunSqlVisor({ app: "tui" })

await sqlv.appState.set("preferences", {
  iconStyle: "nerdfont",
})
```

The current app id is the namespace. We do not need cross-app storage access initially.

## Storage Path Ownership

When a built-in app instantiates `SqlVisor`, it should not need to manually create storage or resolve OS-specific default paths.

Preferred flow:

1. app bootstrap calls a platform factory
2. platform factory resolves the default storage location
3. storage backend opens the DB at that path

Example:

```ts
const sqlv = await createBunSqlVisor({
  app: "tui",
})
```

Not:

```ts
const storage = await createLocalStorage({
  path: someXdgPath,
})
```

Rules:

- `apps/tui` may pass `app: "tui"` and optional explicit overrides like `dbPath`
- `platforms/bun` owns XDG/AppData/Application Support resolution
- low-level storage code accepts a path but should not know what XDG is

For the default encrypted app DB, prefer an OS-native **data** directory, not a config directory.

On Unix-like systems this means `XDG_DATA_HOME`, not `XDG_CONFIG_HOME`.

## DrizzleORM Placement

Drizzle schema belongs with the concrete storage implementation.

Initial location:

```text
platforms/
  bun/
    storage/
      drizzleClient.ts
      schema/
      migrations/
      repositories/
```

Important rule:

- Drizzle schema is storage schema
- `domain/` types are domain types
- repository implementations map between them

Do not use Drizzle table types as domain types.

If multiple SQL-backed platforms eventually share the exact same schema, that schema can be promoted into a shared `platforms/sql/storage/*` area later.

## Naming Summary

- `api/`: public host API
- `domain/`: shared domain layer
- `spi/`: public extension contracts
- `engine/`: private platform-neutral orchestration
- `platforms/`: private concrete runtime/platform implementations
- `adapters/`: built-in plugins implementing the SPI
- `apps/`: concrete hosts built on the API

## Practical Rule of Thumb

A module is in the wrong layer if it mixes concerns like:

- DB driver code and UI rendering
- filesystem/XDG logic and domain orchestration
- adapter implementation and engine workspace state
- app-specific UI preferences and core settings schema

When in doubt:

- keep domain concepts in `domain/`
- keep host-facing convenience in `api/`
- keep adapter contracts in `spi/`
- keep behavioral logic in `engine/`
- keep runtime-specific details in `platforms/`
- keep protocol implementations in `adapters/`
- keep app behavior and presentation in `apps/`
