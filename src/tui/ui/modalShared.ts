export const MODAL_EDGE_MARGIN = 3
export const DEFAULT_MODAL_Z_INDEX = 200

export function resolveModalViewportBounds(terminalWidth: number, terminalHeight: number) {
  const horizontalMargin = Math.min(MODAL_EDGE_MARGIN, Math.max(0, Math.floor((terminalWidth - 1) / 2)))
  const verticalMargin = Math.min(MODAL_EDGE_MARGIN, Math.max(0, Math.floor((terminalHeight - 1) / 2)))

  return {
    horizontalMargin,
    maxPanelHeight: Math.max(1, terminalHeight - verticalMargin * 2),
    maxPanelWidth: Math.max(1, terminalWidth - horizontalMargin * 2),
    verticalMargin,
  }
}
