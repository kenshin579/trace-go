import type { IntervalState } from './format'
import type { EdgeCategory } from './types'

// intervalTooltip describes a hovered timeline interval. The block reason is
// only meaningful (and shown) for blocked intervals that carry one.
export function intervalTooltip(label: string, state: IntervalState, blockReason: string): string {
  const detail = state === 'blocked' && blockReason ? `${state} · ${blockReason}` : state
  return `${label}\n${detail}`
}

// nodeTooltip describes a hovered graph node at the current playhead time.
export function nodeTooltip(label: string, state: IntervalState | null): string {
  return `${label}\n${state ?? 'not running at this time'}`
}

// edgeTooltip describes a hovered causal edge. The trace exposes no channel
// identity or transferred value, so every relation is labelled "(inferred)".
export function edgeTooltip(category: EdgeCategory, fromLabel: string, toLabel: string): string {
  const kind =
    category === 'channel'
      ? 'channel communication'
      : category === 'mutex'
        ? 'mutex synchronization'
        : 'unblock'
  return `${fromLabel} → ${toLabel}\n${kind} (inferred)`
}

// regionTooltip shows a hovered region's name and its duration (ms, 3 decimals).
export function regionTooltip(name: string, start: number, end: number): string {
  return `${name}\n${((end - start) / 1e6).toFixed(3)} ms`
}

// logTooltip shows a hovered log's category and message on two lines.
export function logTooltip(category: string, message: string): string {
  return `${category}\n${message}`
}
