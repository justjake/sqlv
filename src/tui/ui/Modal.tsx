import { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import type { ReactNode } from "react"
import { useTheme } from "./theme"

export type ModalProps = {
  children: ReactNode
  onClose?: () => void
  width?: number
  height?: number
  size?: "medium" | "large"
  zIndex?: number
}

export function Modal(props: ModalProps) {
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions()
  const theme = useTheme()
  const topPadding = Math.max(1, Math.floor(terminalHeight / 4))
  const panelWidth = props.width ?? (props.size === "large" ? 80 : 60)
  const resolvedWidth = Math.max(16, Math.min(panelWidth, terminalWidth - 2))
  const resolvedHeight = props.height === undefined ? undefined : Math.max(1, Math.min(props.height, terminalHeight - topPadding - 1))

  return (
    <box
      alignItems="center"
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
      height={terminalHeight}
      left={0}
      onMouseUp={() => props.onClose?.()}
      paddingBottom={1}
      paddingTop={topPadding}
      position="absolute"
      top={0}
      width={terminalWidth}
      zIndex={props.zIndex ?? 200}
    >
      <box
        backgroundColor={theme.focusHintBg}
        height={resolvedHeight}
        onMouseDown={(event) => {
          event.stopPropagation()
        }}
        onMouseUp={(event) => {
          event.stopPropagation()
        }}
        paddingTop={1}
        width={resolvedWidth}
      >
        {props.children}
      </box>
    </box>
  )
}
