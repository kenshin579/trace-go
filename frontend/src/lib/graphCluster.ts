import type { Goroutine } from './types'

// clusterByTask assigns each goroutine to a task (its first region whose task is
// in knownTaskIds). Goroutines with no such region are left unassigned. Membership
// is time-independent, so the graph can cluster once and never re-layout on time.
export function clusterByTask(goroutines: Goroutine[], knownTaskIds: Set<number>): Map<number, number> {
  const out = new Map<number, number>()
  for (const g of goroutines) {
    const reg = (g.regions ?? []).find((r) => r.task != null && knownTaskIds.has(r.task))
    if (reg) out.set(g.id, reg.task as number)
  }
  return out
}

// convexHull returns the convex boundary (counter-clockwise) of a set of points
// via Andrew's monotone chain. Fewer than 3 points are returned unchanged.
export function convexHull(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points.slice()
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}
