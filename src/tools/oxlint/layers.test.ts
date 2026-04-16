import { describe, expect, test } from "bun:test"

import {
  ALLOWED_TYPE_ONLY,
  ALLOWED_VALUE,
  LAYERS,
  isCompositionRoot,
  layerFromFilePath,
  layerInfoFromFilePath,
  parseAliasSpecifier,
} from "./layers.ts"

describe("layerFromFilePath", () => {
  test("extracts layer from absolute path", () => {
    expect(layerFromFilePath("/Users/foo/src/sqlv/src/engine/SqlVisor.ts")).toBe("engine")
  })

  test("uses the rightmost src/ as the project marker", () => {
    // user's homedir contains 'src' — rule must not be fooled
    expect(layerFromFilePath("/Users/jitl/src/sqlv/src/apps/tui/index.tsx")).toBe("apps")
  })

  test("returns null for non-layer directories like tools/", () => {
    expect(layerFromFilePath("/Users/jitl/src/sqlv/src/tools/oxlint/plugin.ts")).toBeNull()
  })

  test("returns null for src/index.ts (the package barrel)", () => {
    expect(layerFromFilePath("/Users/jitl/src/sqlv/src/index.ts")).toBeNull()
  })

  test("works with project-relative paths", () => {
    expect(layerFromFilePath("src/domain/Connection.ts")).toBe("domain")
  })
})

describe("layerInfoFromFilePath", () => {
  test("returns layer, subpath, and project root", () => {
    const info = layerInfoFromFilePath("/Users/jitl/src/sqlv/src/engine/runtime/QueryRunnerImpl.ts")
    expect(info).toEqual({
      layer: "engine",
      subpath: "runtime/QueryRunnerImpl.ts",
      projectRoot: "/Users/jitl/src/sqlv",
    })
  })
})

describe("parseAliasSpecifier", () => {
  test("parses #domain/Connection", () => {
    expect(parseAliasSpecifier("#domain/Connection")).toEqual({ layer: "domain", subpath: "Connection" })
  })

  test("parses nested subpath #engine/runtime/QueryRunnerImpl", () => {
    expect(parseAliasSpecifier("#engine/runtime/QueryRunnerImpl")).toEqual({
      layer: "engine",
      subpath: "runtime/QueryRunnerImpl",
    })
  })

  test("returns null for unknown layer prefix", () => {
    expect(parseAliasSpecifier("#unknown/foo")).toBeNull()
  })

  test("returns null for bare-package specifiers", () => {
    expect(parseAliasSpecifier("@tanstack/query-core")).toBeNull()
    expect(parseAliasSpecifier("node:path")).toBeNull()
    expect(parseAliasSpecifier("../domain/Foo")).toBeNull()
  })
})

describe("isCompositionRoot", () => {
  test("matches per-platform SqlVisor factories", () => {
    expect(isCompositionRoot("/abs/src/platforms/bun/createBunSqlVisor.ts")).toBe(true)
    expect(isCompositionRoot("/abs/src/platforms/browser/createBrowserSqlVisor.ts")).toBe(true)
  })

  test("matches resolved import targets without extension", () => {
    expect(isCompositionRoot("/abs/src/platforms/bun/createBunSqlVisor")).toBe(true)
  })

  test("matches engine glue files", () => {
    expect(isCompositionRoot("/abs/src/engine/glue/buildEngine.ts")).toBe(true)
    expect(isCompositionRoot("/abs/src/engine/glue/nested/thing.ts")).toBe(true)
  })

  test("does not match other files under platforms/", () => {
    expect(isCompositionRoot("/abs/src/platforms/bun/storage/createLocalStorage.ts")).toBe(false)
    expect(isCompositionRoot("/abs/src/platforms/bun/paths.ts")).toBe(false)
  })

  test("does not match files outside any layer", () => {
    expect(isCompositionRoot("/abs/src/tools/oxlint/plugin.ts")).toBe(false)
  })
})

describe("ALLOWED policy tables", () => {
  test("every known layer has a value-import entry", () => {
    for (const layer of LAYERS) {
      expect(ALLOWED_VALUE[layer]).toBeDefined()
    }
  })

  test("every known layer has a type-only-import entry", () => {
    for (const layer of LAYERS) {
      expect(ALLOWED_TYPE_ONLY[layer]).toBeDefined()
    }
  })

  test("domain is pure for both value and type-only imports", () => {
    expect(ALLOWED_VALUE.domain).toEqual([])
    expect(ALLOWED_TYPE_ONLY.domain).toEqual([])
  })

  test("apps may only reach the public surface", () => {
    expect(ALLOWED_VALUE.apps).toEqual(["api", "domain"])
    expect(ALLOWED_TYPE_ONLY.apps).toEqual(["api", "domain"])
  })

  test("adapters may not import engine, platforms, or apps", () => {
    for (const forbidden of ["engine", "platforms", "apps"] as const) {
      expect(ALLOWED_VALUE.adapters).not.toContain(forbidden)
      expect(ALLOWED_TYPE_ONLY.adapters).not.toContain(forbidden)
    }
  })

  test("engine may import api only via type-only imports", () => {
    expect(ALLOWED_VALUE.engine).not.toContain("api")
    expect(ALLOWED_TYPE_ONLY.engine).toContain("api")
  })
})
