/**
 * Enforces the dependency rules declared in MODULES.md / `layers.ts`.
 *
 * Three behaviors in one rule:
 *
 *  1. Same-layer imports that use `#alias/...` get autofixed to relative imports.
 *     (Inside the engine, `./services/Foo` reads better than `#engine/services/Foo`.)
 *
 *  2. Cross-layer imports that use a relative specifier (`../../domain/Foo`)
 *     get autofixed to `#domain/Foo`. Crossing a layer boundary should be
 *     visible at the import site.
 *
 *  3. Cross-layer imports whose target layer isn't in `ALLOWED[sourceLayer]`
 *     are reported as errors. No autofix — layer violations don't have a
 *     single correct rewrite.
 *
 * Composition roots (see `layers.ts`) are exempt from outbound checks and
 * are publicly importable from any layer.
 */

import * as path from "node:path"

import {
  ALLOWED,
  isLayerBoundaryExempt,
  layerInfoFromFilePath,
  parseAliasSpecifier,
  type Layer,
} from "../layers.ts"

type Literal = { type: "Literal"; value: unknown; range?: [number, number] }
type ImportLike = { type: string; source: Literal | null }

type Fixer = {
  replaceText(node: unknown, text: string): unknown
}

type ReportDescriptor = {
  node: unknown
  message: string
  fix?: (fixer: Fixer) => unknown
}

type LintContext = {
  filename?: string
  physicalFilename?: string
  getFilename?(): string
  report(descriptor: ReportDescriptor): void
}

type FileLayerInfo = {
  layer: Layer
  subpath: string
  projectRoot: string
  dir: string
}

type ResolvedTarget = {
  kind: "alias" | "relative"
  layer: Layer | null
  subpath: string
  /** The specifier we *would* produce in aliased form (for autofix and error messages). */
  aliasForm: string | null
  /** The specifier we *would* produce in relative form from the source file's directory. */
  relativeForm: string | null
}

function buildRelativeForm(fromDir: string, projectRoot: string, layer: Layer, subpath: string): string {
  const targetAbs = path.join(projectRoot, "src", layer, subpath)
  let rel = path.relative(fromDir, targetAbs)
  if (!rel.startsWith(".")) rel = "./" + rel
  return rel
}

function buildAliasForm(layer: Layer, subpath: string): string {
  return subpath ? `#${layer}/${subpath}` : `#${layer}`
}

function resolveRelativeImport(specifier: string, source: FileLayerInfo): ResolvedTarget | null {
  const absTarget = path.resolve(source.dir, specifier)
  const info = layerInfoFromFilePath(absTarget)
  if (!info) return null
  const relativeForm = buildRelativeForm(source.dir, source.projectRoot, info.layer, info.subpath)
  return {
    kind: "relative",
    layer: info.layer,
    subpath: info.subpath,
    aliasForm: buildAliasForm(info.layer, info.subpath),
    relativeForm,
  }
}

function resolveAliasImport(specifier: string, source: FileLayerInfo): ResolvedTarget | null {
  const parsed = parseAliasSpecifier(specifier)
  if (!parsed) return null
  const relativeForm = buildRelativeForm(source.dir, source.projectRoot, parsed.layer, parsed.subpath)
  return {
    kind: "alias",
    layer: parsed.layer,
    subpath: parsed.subpath,
    aliasForm: buildAliasForm(parsed.layer, parsed.subpath),
    relativeForm,
  }
}

function checkImportSource(
  context: LintContext,
  node: ImportLike,
  source: FileLayerInfo,
  sourceIsExempt: boolean,
) {
  const src = node.source
  if (!src) return
  const specifier = typeof src.value === "string" ? src.value : null
  if (!specifier) return

  const target =
    specifier.startsWith("#")
      ? resolveAliasImport(specifier, source)
      : specifier.startsWith(".")
        ? resolveRelativeImport(specifier, source)
        : null

  if (!target || !target.layer) return

  const sameLayer = target.layer === source.layer

  // Check if the import target file itself is a composition root (e.g. createBunSqlVisor.ts).
  // Composition roots are publicly importable from anywhere — skip the allowed-layer check.
  const targetAbs = path.join(source.projectRoot, "src", target.layer, target.subpath)
  const targetIsExempt = isLayerBoundaryExempt(targetAbs)

  // --- Autofix dimension: prefer alias across layers, relative within a layer.
  if (sameLayer && target.kind === "alias" && target.relativeForm) {
    const newSpec = target.relativeForm
    context.report({
      node: src,
      message: `same-layer import should use a relative specifier, not '${specifier}'`,
      fix: (fixer) => fixer.replaceText(src, JSON.stringify(newSpec)),
    })
    return
  }

  if (!sameLayer && target.kind === "relative" && target.aliasForm) {
    // Even if forbidden, normalize to alias first so the violation is visible under a canonical form.
    const newSpec = target.aliasForm
    const forbidden =
      !sourceIsExempt && !targetIsExempt && !ALLOWED[source.layer].includes(target.layer)
    const message = forbidden
      ? `layer '${source.layer}' may not import from layer '${target.layer}' (fix rewrites to '${newSpec}' but the dependency is still forbidden)`
      : `cross-layer import should use an alias: '${newSpec}'`
    context.report({
      node: src,
      message,
      fix: (fixer) => fixer.replaceText(src, JSON.stringify(newSpec)),
    })
    return
  }

  // --- Dependency dimension: flag forbidden cross-layer imports that don't need a rewrite.
  if (!sameLayer) {
    if (sourceIsExempt || targetIsExempt) return
    if (ALLOWED[source.layer].includes(target.layer)) return
    context.report({
      node: src,
      message: `layer '${source.layer}' may not import from layer '${target.layer}' ('${specifier}')`,
    })
  }
}

const rule = {
  meta: {
    type: "problem" as const,
    docs: {
      description: "Enforce module dependency rules declared in MODULES.md.",
    },
    fixable: "code" as const,
    schema: [],
  },
  create(context: LintContext) {
    const filename = context.filename ?? context.physicalFilename ?? context.getFilename?.() ?? ""
    const info = layerInfoFromFilePath(filename)
    if (!info) return {}

    const source: FileLayerInfo = {
      layer: info.layer,
      subpath: info.subpath,
      projectRoot: info.projectRoot,
      dir: path.dirname(filename),
    }
    const sourceIsExempt = isLayerBoundaryExempt(filename)

    const visit = (node: ImportLike) => checkImportSource(context, node, source, sourceIsExempt)
    return {
      ImportDeclaration: visit,
      ExportNamedDeclaration: visit,
      ExportAllDeclaration: visit,
    }
  },
}

export default rule
