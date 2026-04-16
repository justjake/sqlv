import type { TextProps } from "@opentui/react"

import { useTheme } from "./theme"
export function Text(props: TextProps) {
  const { fg, ...rest } = props
  const theme = useTheme()

  return <text {...rest} fg={fg ?? theme.primaryFg} />
}
