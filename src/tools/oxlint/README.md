# oxlint plugin (`sqlv`)

Custom oxlint rules for this repo. Policy lives in [`layers.ts`](./layers.ts);
rule implementations live under [`rules/`](./rules).

## Workflow

```sh
bun run lint       # report violations
bun run lint:fix   # apply autofixes, report remaining violations
bun test src/tools/oxlint   # rule unit tests
```

The `lint` scripts invoke oxlint **via Bun** (`bun ./node_modules/oxlint/bin/oxlint`)
so the plugin's `.ts` files load natively. Running `oxlint` or `bunx oxlint`
directly falls back to Node and fails to load `.ts` plugins on Node < 22.18.

## Rules

### `sqlv/layer-boundaries`

Enforces the dependency rules declared in [`../../../MODULES.md`](../../../MODULES.md)
and encoded as the `ALLOWED` table in [`layers.ts`](./layers.ts).

Three behaviors in one rule:

1. **Same-layer `#alias/...` imports → autofix to relative.**
   Inside a layer, `./services/Foo` is more informative than `#engine/services/Foo`
   because the short path signals "local concern."

2. **Cross-layer relative imports → autofix to `#alias/...`.**
   Crossing a layer boundary should be visible at the import site. After autofix,
   any `../foo/bar` that escaped its layer becomes `#foo/bar`.

3. **Cross-layer imports with a forbidden target layer → error.**
   No autofix — there isn't a single correct rewrite target for a misplaced import.
   If a rule-3 violation also matches rule 2, the fix still applies (to normalize
   the specifier) and the error persists against the aliased form.

### Composition roots

Some files intentionally assemble concrete implementations across layers
(e.g. `platforms/bun/createBunSqlVisor.ts`). They are declared in
`COMPOSITION_ROOTS` in [`layers.ts`](./layers.ts) and:

- may import from any layer (outbound exemption),
- are publicly importable from any layer (inbound exemption).

To add a new composition root, add an entry to `COMPOSITION_ROOTS` — do **not**
reach for a per-file regex.

## Editing the policy

Changes to `LAYERS`, `ALLOWED`, or `COMPOSITION_ROOTS` in `layers.ts` should
also update `MODULES.md` so the prose and the enforced rules stay in sync.
