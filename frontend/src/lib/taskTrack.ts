import { makeTimeScale } from './timeMap'
import type { Task } from './types'

export interface TaskBar {
  id: number
  x: number
  width: number
  depth: number
  name: string
  start: number
  end: number
}

export interface TaskTrack {
  bars: TaskBar[]
  height: number
}

export interface TaskTrackOptions {
  width: number
  gutter: number
  startTime: number
  endTime: number
  taskRowH: number
}

// layoutTaskTrack maps each task to a bar (x/width over the gutter-offset time
// axis) and a depth equal to its parent-chain length, plus the total track
// height ((maxDepth+1) * taskRowH, or 0 when there are no tasks).
export function layoutTaskTrack(tasks: Task[], opts: TaskTrackOptions): TaskTrack {
  if (tasks.length === 0) return { bars: [], height: 0 }
  const byId = new Map<number, Task>(tasks.map((t) => [t.id, t]))
  const depthCache = new Map<number, number>()
  const depthOf = (t: Task): number => {
    if (depthCache.has(t.id)) return depthCache.get(t.id)!
    const parent = byId.get(t.parent)
    const d = parent ? depthOf(parent) + 1 : 0
    depthCache.set(t.id, d)
    return d
  }

  const scale = makeTimeScale(opts.startTime, opts.endTime, opts.gutter, opts.width)
  let maxDepth = 0
  const bars: TaskBar[] = tasks.map((t) => {
    const depth = depthOf(t)
    if (depth > maxDepth) maxDepth = depth
    const x = scale.toPixel(t.start)
    return { id: t.id, x, width: Math.max(1, scale.toPixel(t.end) - x), depth, name: t.name, start: t.start, end: t.end }
  })
  return { bars, height: (maxDepth + 1) * opts.taskRowH }
}
