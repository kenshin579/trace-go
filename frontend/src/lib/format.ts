// Pure display helpers shared by the layout and the canvas renderer.

export function goroutineLabel(g: { id: number; name: string }): string {
  return g.name !== '' ? g.name : `g${g.id}`
}

// effectiveEnd resolves the 0 "never ended" sentinel to the trace end time.
export function effectiveEnd(g: { endedAt: number }, traceEnd: number): number {
  return g.endedAt === 0 ? traceEnd : g.endedAt
}

export type IntervalState = 'running' | 'runnable' | 'blocked'

const STATE_COLORS: Record<IntervalState, string> = {
  running: '#4caf50',
  runnable: '#9aa3b2',
  blocked: '#c25450',
}

// stateColor returns a fill for a known state, or a neutral gray for anything
// unexpected (defensive against future trace states).
export function stateColor(state: IntervalState): string {
  return STATE_COLORS[state] ?? '#5b6270'
}

// Shared graph colors (kept here so the graph renderer and the legend can't drift).
export const DIM_COLOR = '#2a2e38' // node not alive at the current time / inactive edge
export const EDGE_ACTIVE_COLOR = '#5b8def' // edge firing near the playhead

import type { EdgeCategory } from './types'

// Per-category edge/comet colors. These encode the inferred synchronization
// kind, NOT a transferred value (the trace has no channel identity).
export const CATEGORY_COLORS: Record<EdgeCategory, string> = {
  channel: '#5b8def',
  mutex: '#e0a030',
  other: '#a78bdb',
}

export function categoryColor(category: EdgeCategory): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.channel
}
