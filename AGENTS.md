# AGENTS

This file gives repo-specific guidance for agents working in `sqlv`.

## Project Overview

`sqlv` is a Bun + TypeScript project with two main surfaces:

- a reusable library exported from [`src/index.ts`](./src/index.ts)
- an OpenTUI application rooted at [`src/tui/index.tsx`](./src/tui/index.tsx)

The central domain object is `SqlVisor` in [`src/lib/SqlVisor.ts`](./src/lib/SqlVisor.ts). It owns:

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

- `SqlVisor.create()` constructs the engine, adapter registry, persistence, and query client.
- The engine uses `@tanstack/query-core` internally for async loading and query-state transitions.
- Public state is intentionally domain-shaped but follows the TanStack query state model (`status`, `fetchStatus`, `data`, `error`, timestamps/counters).

### Adapters

- Database access is adapter-driven.
- Built-in adapters currently include:
  - `bunsqlite` via [`src/lib/adapters/BunSqlAdapter.ts`](./src/lib/adapters/BunSqlAdapter.ts)
  - `turso` via [`src/lib/adapters/TursoAdapter.ts`](./src/lib/adapters/TursoAdapter.ts)
- Adapter registration is explicit through `AdapterRegistry`. Do not reintroduce side-effect registration.
- Adapters can provide `ConnectionSpec` for UI-driven connection creation. The library should stay UI-agnostic; UI hosts render those specs.

### Persistence

- Local persistence bootstrap lives in [`src/lib/createLocalPersistence.ts`](./src/lib/createLocalPersistence.ts).
- The default persistence connection is a local Turso-backed encrypted SQLite file.
- Persistent row storage is implemented through `Persist` plus the sqlite row-store helpers, not through ad hoc tables scattered through the codebase.

### TUI

- The TUI is a host for `SqlVisor`, not a second state model.
- Prefer pushing domain behavior into `src/lib` and keeping `src/tui` focused on rendering, input binding, and presentation-specific concerns.

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
- avoid leaking React/OpenTUI details into `src/lib`
- avoid leaking low-level TanStack mechanisms such as observers into the public engine surface unless explicitly intended

### Cleanup Bias

If you notice stale abstractions, duplicate representations, or unused compatibility leftovers, prefer removing them rather than preserving them "just in case."

### Verification

Useful repo commands:

- `bun test`
- `./node_modules/.bin/tsc --noEmit --pretty false`
- `bun run lint`
- `bun run format`

## Focus System

The focus system is split intentionally:

- universal focus model in [`src/lib/focus`](./src/lib/focus)
- OpenTUI bindings in [`src/tui/focus`](./src/tui/focus)

Read these before making substantial focus changes:

- [`src/lib/focus/README.md`](./src/lib/focus/README.md)
- [`src/tui/focus/README.md`](./src/tui/focus/README.md)

### Core Principles

- Focus navigation is **not** the same thing as real widget focus.
- The system uses explicit registration. Do not add auto-discovery.
- Identity is path-based. Stable `focusNavigableId` values matter.
- Geometry is lazy and evaluated in global viewport coordinates.
- Areas own trap scope, `Esc`, clipping, reveal, and snapshot/restore behavior.
- Nodes own actual focus targets.
- Cancel should restore navigation-only side effects. Activate should commit them.

### OpenTUI-Specific Rules

- Focus navigation key handling is intentionally installed at the renderer level, not only through local `useKeyboard()` handlers.
- While focus navigation is active, the currently focused renderable may be blurred so arrow keys and `Esc` stop mutating the active widget.
- Widget-local arrow/enter/escape behavior must stand down when focus navigation is active.
- Scroll-follow belongs to `FocusNavigableArea`, not `FocusNavigable`.

### Testing Notes

- Bare `Esc` in OpenTUI is parser-delayed so it can be distinguished from Alt/meta sequences.
- In tests, `ui.mockInput.pressEscape()` may need a small wait before asserting on the resulting frame/state. The current tests use roughly `30ms`.

### Editing Guidance

If you change the focus model or the TUI bindings:

- keep `src/lib/focus` platform-agnostic
- keep OpenTUI-specific behavior in `src/tui/focus`
- update or add tests in `test/lib/focus.test.ts` and relevant TUI integration tests
- update the focus READMEs if the design meaningfully changes

## When In Doubt

Prefer the cleaner design with fewer parallel state machines, fewer duplicate representations, and fewer hidden side effects.
