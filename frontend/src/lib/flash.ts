import type { CausalEdge } from './types'

// A comet animates over this many real (wall-clock) milliseconds, independent
// of playback speed.
export const FLASH_MS = 600

// Cap on concurrently animating comets (guards against a fast scrub spawning a
// storm of them in one step).
export const MAX_PARTICLES = 60

// edgesCrossed returns the edges whose fire time was passed moving the playhead
// FORWARD from prevT to nowT: prevT < time <= nowT. Empty if not advancing.
export function edgesCrossed(edges: CausalEdge[], prevT: number, nowT: number): CausalEdge[] {
  if (nowT <= prevT) return []
  return edges.filter((e) => e.time > prevT && e.time <= nowT)
}

// cometPoint linearly interpolates a point along segment a→b by progress (0..1).
export function cometPoint(
  progress: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number } {
  const p = Math.max(0, Math.min(1, progress))
  return { x: ax + (bx - ax) * p, y: ay + (by - ay) * p }
}
