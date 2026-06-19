import { writable, type Writable } from 'svelte/store'
import type { TraceSummary } from '../lib/types'

export interface TraceStore {
  summary: Writable<TraceSummary | null>
  playhead: Writable<number>
  loadSummary(s: TraceSummary): void
  setPlayhead(t: number): void
}

// createTraceStore holds the loaded trace and the current playhead time.
// Playhead is always clamped to the loaded trace's [startTime, endTime].
export function createTraceStore(): TraceStore {
  const summary = writable<TraceSummary | null>(null)
  const playhead = writable<number>(0)
  let current: TraceSummary | null = null

  return {
    summary,
    playhead,
    loadSummary(s) {
      current = s
      summary.set(s)
      playhead.set(s.startTime)
    },
    setPlayhead(t) {
      if (!current) return
      const clamped = Math.min(current.endTime, Math.max(current.startTime, t))
      playhead.set(clamped)
    },
  }
}

// The app-wide singleton store.
export const traceStore = createTraceStore()
