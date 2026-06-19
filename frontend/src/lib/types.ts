// Frontend mirror of the Go model.TraceSummary JSON contract (internal/model).
// Kept hand-written and minimal so lib/ has no dependency on generated wailsjs.
import type { IntervalState } from './format'

export interface Interval {
  start: number
  end: number
  state: IntervalState
  blockReason?: string
}

export interface Goroutine {
  id: number
  name: string
  createdAt: number
  endedAt: number
  intervals: Interval[]
}

export interface CausalEdge {
  from: number
  to: number
  time: number
  category: 'channel' | 'mutex' | 'other'
}

export interface TraceSummary {
  startTime: number
  endTime: number
  goroutines: Goroutine[]
  edges: CausalEdge[]
}
