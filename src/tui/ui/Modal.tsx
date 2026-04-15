import { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useTheme } from "./theme"

const ModalBottomRightContext = createContext<((node: ReactNode | undefined) => void) | null>(null)

export type ModalProps = {
  children: ReactNode
  bottomRight?: ReactNode
  onClose?: () => void
  width?: number
  height?: number
  size?: "medium" | "large"
  zIndex?: number
}

export function useModalBottomRight(node: ReactNode | undefined) {
  const setBottomRight = useContext(ModalBottomRightContext)

  useEffect(() => {
    if (!setBottomRight) {
      return
    }

    setBottomRight(node)
    return () => {
      setBottomRight(undefined)
    }
  }, [node, setBottomRight])
}

export function Modal(props: ModalProps) {
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions()
  const theme = useTheme()
  const [slottedBottomRight, setSlottedBottomRight] = useState<ReactNode>()
  const topPadding = Math.max(1, Math.floor(terminalHeight / 4))
  const panelWidth = props.width ?? (props.size === "large" ? 80 : 60)
  const resolvedWidth = Math.max(16, Math.min(panelWidth, terminalWidth - 2))
  const resolvedHeight =
    props.height === undefined ? undefined : Math.max(1, Math.min(props.height, terminalHeight - topPadding - 1))
  const bottomRight = slottedBottomRight ?? props.bottomRight

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
      <ModalBottomRightContext value={setSlottedBottomRight}>
        <box
          backgroundColor={theme.focusHintBg}
          flexDirection="column"
          height={resolvedHeight}
          onMouseDown={(event) => {
            event.stopPropagation()
          }}
          onMouseUp={(event) => {
            event.stopPropagation()
          }}
          position="relative"
          width={resolvedWidth}
        >
          <box flexGrow={1} minHeight={0} paddingBottom={bottomRight ? 2 : 0} paddingTop={1}>
            {props.children}
          </box>
          {bottomRight && (
            <box bottom={1} position="absolute" right={1} zIndex={1}>
              {bottomRight}
            </box>
          )}
        </box>
      </ModalBottomRightContext>
    </box>
  )
}
