import type { Lane, LayoutRect, RegionRect, LogMarker } from './timelineLayout'

export type TimelineHit =
  | { kind: 'interval'; lane: Lane; rect: LayoutRect }
  | { kind: 'region'; lane: Lane; region: RegionRect }
  | { kind: 'log'; lane: Lane; log: LogMarker }
  | null

const LOG_HIT_PX = 5

// hitTimeline finds what is under a point in timeline canvas coordinates, using
// each lane's own y/totalHeight (lanes are variable-height). A log marker in the
// state row wins over the interval beneath it; region rows sit below the state row.
export function hitTimeline(lanes: Lane[], x: number, y: number, regionRowH: number): TimelineHit {
  const lane = lanes.find((l) => y >= l.y && y < l.y + l.totalHeight)
  if (!lane) return null
  const localY = y - lane.y

  if (localY < lane.height) {
    // State row: a nearby log marker wins, else the interval under x.
    const log = lane.logs.find((lg) => Math.abs(lg.x - x) <= LOG_HIT_PX)
    if (log) return { kind: 'log', lane, log }
    const rect = lane.rects.find((r) => x >= r.x && x < r.x + r.width)
    return rect ? { kind: 'interval', lane, rect } : null
  }

  // Region rows below the state row.
  const depth = Math.floor((localY - lane.height) / regionRowH)
  const region = lane.regions.find((r) => r.depth === depth && x >= r.x && x < r.x + r.width)
  return region ? { kind: 'region', lane, region } : null
}

// nodeAtPoint returns the first node whose center is within radius of the point.
export function nodeAtPoint<T extends { x?: number; y?: number }>(
  nodes: T[],
  px: number,
  py: number,
  radius: number,
): T | undefined {
  return nodes.find((n) => n.x != null && n.y != null && Math.hypot(n.x - px, n.y - py) <= radius)
}

// distToSegment is the shortest distance from point (px,py) to segment a-b,
// clamped to the segment endpoints. Used for graph edge hover hit-testing.
export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
