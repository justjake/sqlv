import layerBoundaries from "./rules/layer-boundaries.ts"

const plugin = {
  meta: { name: "sqlv" },
  rules: {
    "layer-boundaries": layerBoundaries,
  },
}

export default plugin
