# AGENTS

This file gives repo-specific guidance for agents working in `sqlv`.

## Project Overview

`sqlv` is a Bun + TypeScript project with two main surfaces:

- a reusable library exported from [`src/index.ts`](./src/index.ts)
- an OpenTUI application rooted at [`src/apps/tui/index.tsx`](./src/apps/tui/index.tsx)

The central engine type is `SqlVisor` in [`src/engine/SqlVisor.ts`](./src/engine/SqlVisor.ts), re-exported publicly from [`src/api/SqlVisor.ts`](./src/api/SqlVisor.ts). It owns:

- connection state
- selected connection
- query editor state
- query execution state
- query history
- detail view state
- loaded database objects
- active query tracking and cancellation

The engine is intended to be the public API boundary. The TUI should consume engine state, not recreate parallel domain state.

## Current Architecture

### Engine

- `SqlVisor.create()` is the platform-neutral engine factory. It expects explicit storage plus an adapter registry.
- `createBunSqlVisor()` in [`src/platforms/bun/createBunSqlVisor.ts`](./src/platforms/bun/createBunSqlVisor.ts) is the Bun/local composition root.
- The engine uses `@tanstack/query-core` internally for async loading and query-state transitions.
- Public state is intentionally domain-shaped but follows the TanStack query state model (`status`, `fetchStatus`, `data`, `error`, timestamps/counters).

### Adapters

- Database access is adapter-driven.
- Built-in adapters currently include:
  - `bunsqlite` via [`src/adapters/sqlite/bun/BunSqliteAdapter.ts`](./src/adapters/sqlite/bun/BunSqliteAdapter.ts)
  - `turso` via [`src/adapters/sqlite/turso/TursoAdapter.ts`](./src/adapters/sqlite/turso/TursoAdapter.ts)
- Adapters can provide `ConnectionSpec` for UI-driven connection creation. The library should stay UI-agnostic; UI hosts render those specs.

### Storage

- Local Bun storage bootstrap lives in [`src/platforms/bun/storage/createLocalStorage.ts`](./src/platforms/bun/storage/createLocalStorage.ts).
- The default Bun storage connection is a local Turso-backed encrypted SQLite file.
- App-specific host preferences belong in app state, not core settings.
- Core row storage is implemented through [`src/platforms/bun/storage/Storage.ts`](./src/platforms/bun/storage/Storage.ts) plus the sqlite row-store helpers, not through ad hoc tables scattered through the codebase.

### TUI

- The TUI is a host for `SqlVisor`, not a second state model.
- Prefer pushing domain behavior into `src/engine`, `src/model`, and `src/spi`, and keep `src/apps/tui` focused on rendering, input binding, and presentation-specific concerns.

## Repo Conventions

### Backward Compatibility

Do **not** optimize for backward compatibility yet.

This repo has not shipped. Prefer:

- deleting vestigial APIs
- simplifying abstractions
- removing migration/shim code
- breaking internal callers if the result is cleaner

Do not add compatibility layers unless the user explicitly asks for one.

### Public API Direction

The intended direction is an easy public engine interface around the existing complexity. Keep that in mind when making changes:

- prefer domain concepts over transport/mechanism concepts
- avoid leaking React/OpenTUI details into `src/engine`, `src/model`, or `src/spi`
- avoid leaking low-level TanStack mechanisms such as observers into the public engine surface unless explicitly intended

### Cleanup Bias

If you notice stale abstractions, duplicate representations, or unused compatibility leftovers, prefer removing them rather than preserving them "just in case."

### Module Boundaries

- Do not use `index.ts` or other barrel modules without duress.
- Prefer direct file imports for internal code.
- Keep barrel files only when they are serving a real boundary such as the package public API.

### Focus Path Discipline

- Treat `Focusable` paths as opaque values.
- You may compare paths against paths, but do not inspect individual path segment values for application logic.
- Do not store domain information in `focusableId` values or other focus path segments.
- If UI state needs to correlate domain objects with focus, keep an explicit mapping outside the path instead of encoding or parsing IDs.

### Verification

Useful repo commands:

- `bun test`
- `./node_modules/.bin/tsc --noEmit --pretty false`
- `bun run lint`
- `bun run format`

## Focus System

The focus system is split intentionally:

- universal focus model in [`src/apps/framework/focus`](./src/apps/framework/focus)
- OpenTUI bindings in [`src/apps/tui/focus`](./src/apps/tui/focus)

Read these before making substantial focus changes:

- [`src/apps/framework/focus/README.md`](./src/apps/framework/focus/README.md)
- [`src/apps/tui/focus/README.md`](./src/apps/tui/focus/README.md)

### Core Principles

- Focus navigation is **not** the same thing as real widget focus.
- The system uses explicit registration. Do not add auto-discovery.
- Identity is path-based. Stable `focusableId` values matter.
- Geometry is lazy and evaluated in global viewport coordinates.
- The core now uses one normalized `Focusable` participant type with capabilities like `focusable`, `navigable`, `childrenNavigable`, `delegatesFocus`, and `trap`.
- Composite widgets should prefer focus memory plus `delegatesFocus` over keeping their own duplicate "selected item for restore" state.
- `Esc` first tries to step to the nearest ancestor focusable within the current scope. At a trap root, the next `Esc` starts focus navigation, and only `Esc` from focus-navigation mode triggers `onTrapEsc`.
- Cancel should restore navigation-only side effects. Activate should commit them.

### OpenTUI-Specific Rules

- TUI keyboard dispatch is centralized in `KeybindProvider` via a renderer-level `prependListener("keypress", ...)`.
- App code should use `useShortcut()` for declarative bindings and `useKeybindHandler()` for complex scoped keymaps; do not add new raw `useKeyboard()` or leaf-level `prependListener()` hacks for pane-local behavior.
- Focus navigation is a fallback inside that central router, not a separate per-widget keyboard system.
- While focus navigation is active, the currently focused renderable may be blurred so arrow keys and `Esc` stop mutating the active widget.
- Widget-local arrow/enter/escape behavior must stand down when focus navigation is active.
- Structural focusable registration now happens in `useInsertionEffect`; the provider calls `flushPendingChanges()` in layout so subscriber notification only happens when observable focus state actually changes.
- Scroll-follow, clipping, trap behavior, and snapshot/restore are capabilities on `Focusable`, not a separate wrapper type.
- If a wrapper is structural and should not become an `Esc` step-out target, leave it non-focusable instead of inventing a second wrapper abstraction.

### Testing Notes

- Bare `Esc` in OpenTUI is parser-delayed so it can be distinguished from Alt/meta sequences.
- In tests, `ui.mockInput.pressEscape()` may need a small wait before asserting on the resulting frame/state. The current tests use roughly `30ms`.

### Editing Guidance

If you change the focus model or the TUI bindings:

- keep `src/apps/framework/focus` platform-agnostic
- keep OpenTUI-specific behavior in `src/apps/tui/focus`
- update or add tests in `test/lib/focus.test.ts` and relevant TUI integration tests
- update the focus READMEs if the design meaningfully changes

## When In Doubt

Prefer the cleaner design with fewer parallel state machines, fewer duplicate representations, and fewer hidden side effects.
