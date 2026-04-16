import layerBoundaries from "./rules/layer-boundaries.ts"
import noRawTextElement from "./rules/no-raw-text-element.ts"

const plugin = {
  meta: { name: "sqlv" },
  rules: {
    "layer-boundaries": layerBoundaries,
    "no-raw-text-element": noRawTextElement,
  },
}

export default plugin
