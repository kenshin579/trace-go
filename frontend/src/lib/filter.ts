import type { Goroutine, TraceSummary } from './types'

// isSystemGoroutine reports whether a goroutine is a Go runtime internal
// (forcegchelper, bgsweep, trace plumbing, etc.). These are parked for most or
// all of a trace and add noise to the timeline. The main goroutine has an empty
// name and is intentionally NOT treated as a system goroutine. This is a name
// heuristic: a user package literally named "runtime" would be a false positive,
// but that is vanishingly rare and the stdlib runtime frames are unambiguous.
export function isSystemGoroutine(g: Pick<Goroutine, 'id' | 'name'>): boolean {
  return g.name.startsWith('runtime.') || g.name.startsWith('runtime/')
}

// visibleGoroutines returns the goroutines to render given the showSystem flag,
// preserving the summary's ordering.
export function visibleGoroutines(summary: TraceSummary, showSystem: boolean): Goroutine[] {
  if (showSystem) return summary.goroutines
  return summary.goroutines.filter((g) => !isSystemGoroutine(g))
}
