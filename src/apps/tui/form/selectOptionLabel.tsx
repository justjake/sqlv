import type { ReactNode } from "react"

import { Text } from "../ui/Text"

export function renderSelectOptionLabel(label: ReactNode, textColor?: string) {
  if (typeof label === "string" || typeof label === "number") {
    return (
      <Text fg={textColor} flexShrink={1} truncate wrapMode="none">
        {label}
      </Text>
    )
  }

  return label
}
