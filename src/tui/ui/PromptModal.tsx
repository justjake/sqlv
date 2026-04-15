import { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import type { ReactNode } from "react"
import { Focusable } from "../focus"
import { Text } from "./Text"
import { useTheme } from "./theme"

const MODAL_EDGE_MARGIN = 3

export type PromptModalProps = {
  children: ReactNode
  footer?: ReactNode
  focusableId: string
  onClose?: () => void
  title?: ReactNode
  trapEscLabel?: string
  zIndex?: number
}

export function PromptModal(props: PromptModalProps) {
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions()
  const theme = useTheme()
  const horizontalMargin = Math.min(MODAL_EDGE_MARGIN, Math.max(0, Math.floor((terminalWidth - 1) / 2)))
  const verticalMargin = Math.min(MODAL_EDGE_MARGIN, Math.max(0, Math.floor((terminalHeight - 1) / 2)))
  const maxPanelWidth = Math.max(1, terminalWidth - horizontalMargin * 2)
  const maxBodyWidth = Math.max(1, maxPanelWidth - 4)
  const maxPanelHeight = Math.max(1, terminalHeight - verticalMargin * 2)

  return (
    <Focusable
      autoFocus
      alignItems="center"
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
      flexDirection="column"
      focusable={false}
      focusableId={props.focusableId}
      height={terminalHeight}
      hideNavigationHalo
      justifyContent="center"
      left={0}
      navigable={false}
      onMouseUp={() => props.onClose?.()}
      onTrapEsc={props.onClose}
      paddingBottom={verticalMargin}
      paddingLeft={horizontalMargin}
      paddingRight={horizontalMargin}
      paddingTop={verticalMargin}
      position="absolute"
      top={0}
      trap
      trapEscLabel={props.trapEscLabel}
      width={terminalWidth}
      zIndex={props.zIndex ?? 200}
    >
      <Focusable
        delegatesFocus
        focusSelf
        focusable
        focusableId="panel"
        hideNavigationHalo
        maxHeight={maxPanelHeight}
        maxWidth={maxPanelWidth}
      >
        <box
          backgroundColor={theme.inputBg}
          border
          borderColor={theme.borderColor}
          borderStyle="single"
          flexDirection="column"
          onMouseDown={(event) => {
            event.stopPropagation()
          }}
          onMouseUp={(event) => {
            event.stopPropagation()
          }}
        >
          {props.title ? (
            <box
              alignSelf="stretch"
              justifyContent="center"
              maxWidth={maxBodyWidth}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              paddingTop={1}
            >
              {renderPromptTextLikeNode(props.title)}
            </box>
          ) : null}
          <box
            alignSelf="stretch"
            flexDirection="column"
            maxWidth={maxBodyWidth}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={props.title ? 0 : 1}
          >
            {renderPromptTextLikeNode(props.children)}
          </box>
          {props.footer ? (
            <box
              alignSelf="stretch"
              border={["top"]}
              borderColor={theme.borderColor}
              flexDirection="row"
              gap={1}
              justifyContent="flex-end"
              padding={1}
            >
              {props.footer}
            </box>
          ) : null}
        </box>
      </Focusable>
    </Focusable>
  )
}

function renderPromptTextLikeNode(node: ReactNode) {
  if (typeof node === "string" || typeof node === "number") {
    return <Text wrapMode="word">{node}</Text>
  }

  return node
}
