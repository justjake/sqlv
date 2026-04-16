import type { FocusDirection, FocusPath, FocusRect } from "./types"

export type MeasuredFocusNode = {
  path: FocusPath
  rect: FocusRect
  order: number
}

type ScoredFocusNode = {
  node: MeasuredFocusNode
  overlapsOrthogonalAxis: boolean
  primaryDistance: number
  orthogonalCenterDistance: number
}

export function chooseNextFocusNavigable(
  source: MeasuredFocusNode,
  candidates: MeasuredFocusNode[],
  direction: FocusDirection,
): MeasuredFocusNode | undefined {
  let best: ScoredFocusNode | undefined
  for (const candidate of candidates) {
    const score = scoreCandidate(source.rect, candidate, direction)
    if (!score) {
      continue
    }
    if (!best || compareScores(score, best) < 0) {
      best = score
    }
  }
  return best?.node
}

function scoreCandidate(
  source: FocusRect,
  candidate: MeasuredFocusNode,
  direction: FocusDirection,
): ScoredFocusNode | undefined {
  if (!isInHalfPlane(source, candidate.rect, direction)) {
    return undefined
  }
  return {
    node: candidate,
    overlapsOrthogonalAxis: orthogonalIntervalsOverlap(source, candidate.rect, direction),
    primaryDistance: primaryDistance(source, candidate.rect, direction),
    orthogonalCenterDistance: orthogonalCenterDistance(source, candidate.rect, direction),
  }
}

function compareScores(a: ScoredFocusNode, b: ScoredFocusNode): number {
  if (a.overlapsOrthogonalAxis !== b.overlapsOrthogonalAxis) {
    return a.overlapsOrthogonalAxis ? -1 : 1
  }
  if (a.primaryDistance !== b.primaryDistance) {
    return a.primaryDistance - b.primaryDistance
  }
  if (a.orthogonalCenterDistance !== b.orthogonalCenterDistance) {
    return a.orthogonalCenterDistance - b.orthogonalCenterDistance
  }
  return a.node.order - b.node.order
}

function isInHalfPlane(source: FocusRect, candidate: FocusRect, direction: FocusDirection): boolean {
  const sourceCenterX = source.x + source.width / 2
  const sourceCenterY = source.y + source.height / 2
  const candidateCenterX = candidate.x + candidate.width / 2
  const candidateCenterY = candidate.y + candidate.height / 2

  switch (direction) {
    case "up":
      return candidateCenterY < sourceCenterY
    case "down":
      return candidateCenterY > sourceCenterY
    case "left":
      return candidateCenterX < sourceCenterX
    case "right":
      return candidateCenterX > sourceCenterX
  }
}

function orthogonalIntervalsOverlap(source: FocusRect, candidate: FocusRect, direction: FocusDirection): boolean {
  if (direction === "left" || direction === "right") {
    return intervalsOverlap(source.y, source.y + source.height, candidate.y, candidate.y + candidate.height)
  }
  return intervalsOverlap(source.x, source.x + source.width, candidate.x, candidate.x + candidate.width)
}

function primaryDistance(source: FocusRect, candidate: FocusRect, direction: FocusDirection): number {
  switch (direction) {
    case "up":
      return Math.max(0, source.y - (candidate.y + candidate.height))
    case "down":
      return Math.max(0, candidate.y - (source.y + source.height))
    case "left":
      return Math.max(0, source.x - (candidate.x + candidate.width))
    case "right":
      return Math.max(0, candidate.x - (source.x + source.width))
  }
}

function orthogonalCenterDistance(source: FocusRect, candidate: FocusRect, direction: FocusDirection): number {
  if (direction === "left" || direction === "right") {
    return Math.abs(source.y + source.height / 2 - (candidate.y + candidate.height / 2))
  }
  return Math.abs(source.x + source.width / 2 - (candidate.x + candidate.width / 2))
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}
