import { makeTimeScale } from './timeMap'
import { goroutineLabel, stateColor, type IntervalState } from './format'
import type { TraceSummary, Log, Goroutine } from './types'
import type { GoroutineGroup } from './grouping'

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
  topOffset?: number // reserved space above the first lane (e.g. a task track)
}

export const GROUP_HEADER_H = 16

export type TimelineRow =
  | ({ kind: 'lane' } & Lane)
  | { kind: 'header'; key: string; name: string; count: number; collapsed: boolean; y: number; height: number }

// layoutTimeline maps the trace span onto [gutter, width] and stacks one lane per
// goroutine. A goroutine with regions grows by (maxDepth+1) region rows; others
// stay at laneHeight. Region spans and the goroutine's logs are attached per lane.
export function layoutTimeline(summary: TraceSummary, opts: LayoutOptions): Lane[] {
  const gutter = opts.gutter ?? 0
  const regionRowH = opts.regionRowH ?? 0
  const scale = makeTimeScale(summary.startTime, summary.endTime, gutter, opts.width)
  const logsByGo = buildLogsByGo(summary)
  const lanes: Lane[] = []
  let y = opts.topOffset ?? 0
  for (const g of summary.goroutines) {
    const lane = buildLane(g, scale, regionRowH, opts.laneHeight, logsByGo, y)
    lanes.push(lane)
    y += lane.totalHeight + opts.laneGap
  }
  return lanes
}

// buildLane constructs a single goroutine's Lane at vertical offset y, using a
// pre-built time scale and a logs-by-goroutine map. Shared by layoutTimeline and
// layoutTimelineRows so lane geometry stays identical between them.
function buildLane(
  g: Goroutine,
  scale: ReturnType<typeof makeTimeScale>,
  regionRowH: number,
  laneHeight: number,
  logsByGo: Map<number, Log[]>,
  y: number,
): Lane {
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
    return { x, width: Math.max(1, scale.toPixel(r.end) - x), depth: r.depth, name: r.name, start: r.start, end: r.end }
  })
  const maxDepth = regs.reduce((m, r) => Math.max(m, r.depth), -1)
  const totalHeight = laneHeight + (maxDepth + 1) * regionRowH
  const logs: LogMarker[] = (logsByGo.get(g.id) ?? []).map((lg) => ({
    x: scale.toPixel(lg.time),
    category: lg.category,
    message: lg.message,
  }))
  return { goroutineId: g.id, label: goroutineLabel(g), y, height: laneHeight, totalHeight, rects, regions, logs }
}

// buildLogsByGo groups a summary's logs by goroutine id.
function buildLogsByGo(summary: TraceSummary): Map<number, Log[]> {
  const logsByGo = new Map<number, Log[]>()
  for (const lg of summary.logs ?? []) {
    const arr = logsByGo.get(lg.goId)
    if (arr) arr.push(lg)
    else logsByGo.set(lg.goId, [lg])
  }
  return logsByGo
}

// layoutTimelineRows lays out grouped goroutines as an ordered row list: a real
// group (>=2 members) gets a header row, followed by its member lanes unless the
// group key is in collapsedKeys; a solo group (1 member) becomes a bare lane row.
// Lane geometry matches layoutTimeline exactly (shared buildLane).
export function layoutTimelineRows(
  summary: TraceSummary,
  groups: GoroutineGroup[],
  collapsedKeys: Set<string>,
  opts: LayoutOptions,
): TimelineRow[] {
  const gutter = opts.gutter ?? 0
  const regionRowH = opts.regionRowH ?? 0
  const scale = makeTimeScale(summary.startTime, summary.endTime, gutter, opts.width)
  const logsByGo = buildLogsByGo(summary)
  const rows: TimelineRow[] = []
  let y = opts.topOffset ?? 0
  for (const group of groups) {
    if (group.members.length >= 2) {
      const collapsed = collapsedKeys.has(group.key)
      rows.push({ kind: 'header', key: group.key, name: group.name, count: group.members.length, collapsed, y, height: GROUP_HEADER_H })
      y += GROUP_HEADER_H + opts.laneGap
      if (collapsed) continue
    }
    for (const g of group.members) {
      const lane = buildLane(g, scale, regionRowH, opts.laneHeight, logsByGo, y)
      rows.push({ kind: 'lane', ...lane })
      y += lane.totalHeight + opts.laneGap
    }
  }
  return rows
}

// hitGroupHeader returns the group key of the header row containing y, or null
// (the header row is full-width, so only y matters).
export function hitGroupHeader(rows: TimelineRow[], y: number): string | null {
  for (const r of rows) {
    if (r.kind === 'header' && y >= r.y && y < r.y + r.height) return r.key
  }
  return null
}
