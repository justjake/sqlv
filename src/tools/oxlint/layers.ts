/**
 * Layer topology for sqlv's module architecture.
 *
 * Keep in sync with MODULES.md — the rules table below *is* the spec that
 * `layer-boundaries` enforces. When you add a layer or change a dependency
 * direction, update both here and the doc.
 */

export const LAYERS = ["domain", "spi", "engine", "platforms", "adapters", "api", "apps"] as const
export type Layer = (typeof LAYERS)[number]

/** For each layer, the other layers it is allowed to import from (besides itself). */
export const ALLOWED: Record<Layer, readonly Layer[]> = {
  domain: [],
  spi: ["domain"],
  engine: ["domain", "spi"],
  platforms: ["domain", "spi", "engine"],
  adapters: ["domain", "spi"],
  api: ["domain", "spi", "engine"],
  apps: ["api", "domain"],
}

/**
 * Composition roots — files that assemble concrete implementations from
 * abstract dependencies. They are exempt from outbound layer checks
 * (may import anything) and are publicly importable from any layer.
 *
 * Each entry declares the layer and the path *within* that layer, as a
 * simple glob (extension-agnostic). Match glob syntax:
 *   `*`  — any sequence of characters except `/`
 *   `**` — any sequence of characters, including `/`
 */
export type CompositionRootSpec = {
  layer: Layer
  subpathGlob: string
  description: string
}

export const COMPOSITION_ROOTS: readonly CompositionRootSpec[] = [
  {
    layer: "platforms",
    subpathGlob: "*/create*SqlVisor",
    description: "Per-platform SqlVisor factories (e.g. platforms/bun/createBunSqlVisor.ts)",
  },
  {
    layer: "engine",
    subpathGlob: "composition/**",
    description: "Engine composition assemblers (e.g. engine/composition/buildEngine.ts)",
  },
]

const LAYER_SET = new Set<string>(LAYERS)

export function isLayer(value: string | undefined): value is Layer {
  return value !== undefined && LAYER_SET.has(value)
}

const ALIAS_LAYER_RE = /^#([^/]+)\/(.*)$/

/**
 * Extracts the layer and subpath from an `#alias/...` import specifier.
 * Returns null for non-alias specifiers or unknown layer prefixes.
 */
export function parseAliasSpecifier(
  specifier: string,
): { layer: Layer; subpath: string } | null {
  const match = ALIAS_LAYER_RE.exec(specifier)
  if (!match) return null
  const [, layerCandidate, subpath] = match
  return isLayer(layerCandidate) ? { layer: layerCandidate as Layer, subpath: subpath ?? "" } : null
}

/**
 * Returns the layer a file belongs to, plus the subpath *within* that layer.
 *
 * Uses the **last** occurrence of `src/` as the project root marker so we aren't
 * fooled by paths like `/Users/someone/src/sqlv/src/apps/...` where the user's
 * home directory happens to contain `src`.
 */
export function layerInfoFromFilePath(
  file: string,
): { layer: Layer; subpath: string; projectRoot: string } | null {
  const parts = file.split("/")
  let srcIdx = -1
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === "src") {
      srcIdx = i
      break
    }
  }
  if (srcIdx === -1 || srcIdx + 1 >= parts.length) return null
  const candidate = parts[srcIdx + 1]
  if (!isLayer(candidate)) return null
  const projectRoot = parts.slice(0, srcIdx).join("/") || "/"
  const subpath = parts.slice(srcIdx + 2).join("/")
  return { layer: candidate as Layer, subpath, projectRoot }
}

/** Convenience: just the layer, discarding subpath/root info. */
export function layerFromFilePath(file: string): Layer | null {
  return layerInfoFromFilePath(file)?.layer ?? null
}

// --- Mechanism: composition-root matching -----------------------------------

const SOURCE_EXT_RE = /\.(tsx?|jsx?|mjs|cjs)$/

function stripExt(subpath: string): string {
  return subpath.replace(SOURCE_EXT_RE, "")
}

const compiledCompositionRoots = COMPOSITION_ROOTS.map((spec) => ({
  layer: spec.layer,
  glob: new Bun.Glob(spec.subpathGlob),
}))

export function isCompositionRoot(file: string): boolean {
  const info = layerInfoFromFilePath(file)
  if (!info) return false
  const subpath = stripExt(info.subpath)
  return compiledCompositionRoots.some(({ layer, glob }) => layer === info.layer && glob.match(subpath))
}
