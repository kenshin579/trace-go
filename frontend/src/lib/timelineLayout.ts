import { makeTimeScale } from './timeMap'
import { goroutineLabel, stateColor, type IntervalState } from './format'
import type { TraceSummary, Log } from './types'

export interface LayoutRect {
  x: number
  width: number
  state: IntervalState
  color: string
  blockReason: string
}

export interface RegionRect {
  x: number
  width: number
  depth: number
  name: string
  start: number // real trace time (ns), for an accurate hover duration
  end: number
}

export interface LogMarker {
  x: number
  category: string
  message: string
}

export interface Lane {
  goroutineId: number
  label: string
  y: number
  height: number // state row height (state intervals are drawn at this height)
  totalHeight: number // state row + region rows
  rects: LayoutRect[]
  regions: RegionRect[]
  logs: LogMarker[]
}

export interface LayoutOptions {
  width: number // pixel width of the time axis
  laneHeight: number
  laneGap: number
  gutter?: number // left offset reserved for lane labels
  regionRowH?: number // height of one region sub-row (0/undefined => no region rows)
}

// layoutTimeline maps the trace span onto [gutter, width] and stacks one lane per
// goroutine. A goroutine with regions grows by (maxDepth+1) region rows; others
// stay at laneHeight. Region spans and the goroutine's logs are attached per lane.
export function layoutTimeline(summary: TraceSummary, opts: LayoutOptions): Lane[] {
  const gutter = opts.gutter ?? 0
  const regionRowH = opts.regionRowH ?? 0
  const scale = makeTimeScale(summary.startTime, summary.endTime, gutter, opts.width)

  const logsByGo = new Map<number, Log[]>()
  for (const lg of summary.logs ?? []) {
    const arr = logsByGo.get(lg.goId)
    if (arr) arr.push(lg)
    else logsByGo.set(lg.goId, [lg])
  }

  const lanes: Lane[] = []
  let y = 0
  for (const g of summary.goroutines) {
    const rects: LayoutRect[] = (g.intervals ?? []).map((iv) => {
      const x = scale.toPixel(iv.start)
      return {
        x,
        width: Math.max(1, scale.toPixel(iv.end) - x),
        state: iv.state,
        color: stateColor(iv.state),
        blockReason: iv.blockReason ?? '',
      }
    })

    const regs = g.regions ?? []
    const regions: RegionRect[] = regs.map((r) => {
      const x = scale.toPixel(r.start)
      return {
        x,
        width: Math.max(1, scale.toPixel(r.end) - x),
        depth: r.depth,
        name: r.name,
        start: r.start,
        end: r.end,
      }
    })
    const maxDepth = regs.reduce((m, r) => Math.max(m, r.depth), -1)
    const regionRows = maxDepth + 1 // -1 => 0 rows when no regions
    const totalHeight = opts.laneHeight + regionRows * regionRowH

    const logs: LogMarker[] = (logsByGo.get(g.id) ?? []).map((lg) => ({
      x: scale.toPixel(lg.time),
      category: lg.category,
      message: lg.message,
    }))

    lanes.push({
      goroutineId: g.id,
      label: goroutineLabel(g),
      y,
      height: opts.laneHeight,
      totalHeight,
      rects,
      regions,
      logs,
    })
    y += totalHeight + opts.laneGap
  }
  return lanes
}
