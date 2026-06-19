import { makeTimeScale } from './timeMap'
import { goroutineLabel, effectiveEnd, stateColor, type IntervalState } from './format'
import type { TraceSummary } from './types'

export interface LayoutRect {
  x: number
  width: number
  state: IntervalState
  color: string
  blockReason: string
}

export interface Lane {
  goroutineId: number
  label: string
  y: number
  height: number
  rects: LayoutRect[]
}

export interface LayoutOptions {
  width: number // pixel width of the time axis
  laneHeight: number
  laneGap: number
}

// layoutTimeline maps the whole trace span onto [0, width] and produces one
// lane per goroutine. Each interval becomes a rect with a minimum width of 1px
// so sub-pixel intervals stay visible.
export function layoutTimeline(summary: TraceSummary, opts: LayoutOptions): Lane[] {
  const scale = makeTimeScale(summary.startTime, summary.endTime, 0, opts.width)
  return summary.goroutines.map((g, i) => {
    const rects: LayoutRect[] = g.intervals.map((iv) => {
      const end = iv.end === 0 ? effectiveEnd(g, summary.endTime) : iv.end
      const x = scale.toPixel(iv.start)
      const rawWidth = scale.toPixel(end) - x
      return {
        x,
        width: Math.max(1, rawWidth),
        state: iv.state,
        color: stateColor(iv.state),
        blockReason: iv.blockReason ?? '',
      }
    })
    return {
      goroutineId: g.id,
      label: goroutineLabel(g),
      y: i * (opts.laneHeight + opts.laneGap),
      height: opts.laneHeight,
      rects,
    }
  })
}
