import { makeTimeScale } from './timeMap'
import { goroutineLabel, stateColor, type IntervalState } from './format'
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
  gutter?: number // left offset reserved for lane labels; time axis starts here
}

// layoutTimeline maps the whole trace span onto [0, width] and produces one
// lane per goroutine. Each interval becomes a rect with a minimum width of 1px
// so sub-pixel intervals stay visible.
export function layoutTimeline(summary: TraceSummary, opts: LayoutOptions): Lane[] {
  const scale = makeTimeScale(summary.startTime, summary.endTime, opts.gutter ?? 0, opts.width)
  return summary.goroutines.map((g, i) => {
    const rects: LayoutRect[] = g.intervals.map((iv) => {
      // The parser always sets a real Interval.End (a state-transition time, or
      // the trace end for still-open intervals); only Goroutine.endedAt uses the
      // 0 "never ended" sentinel. So iv.end is used directly here. Goroutine
      // lifetime (effectiveEnd) is a lane-level concern, not per-interval.
      const x = scale.toPixel(iv.start)
      const rawWidth = scale.toPixel(iv.end) - x
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
