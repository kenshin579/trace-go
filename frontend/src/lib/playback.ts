// Real-time playback advance for the timeline playhead.

// At 1x speed, the entire trace span plays over BASE_PLAY_MS of wall-clock time.
export const BASE_PLAY_MS = 4000

export interface Advance {
  time: number // new playhead time (trace ns), clamped to [startTime, endTime]
  atEnd: boolean // true once the playhead reaches endTime
}

// nextPlayhead advances `current` by `dtMs` of real time at `speed`, mapping the
// whole [startTime, endTime] span onto baseMs of real time. The result is
// clamped to endTime; atEnd is true once the end is reached (or the span is 0).
export function nextPlayhead(
  current: number,
  dtMs: number,
  speed: number,
  startTime: number,
  endTime: number,
  baseMs: number = BASE_PLAY_MS,
): Advance {
  const span = endTime - startTime
  if (span <= 0) return { time: endTime, atEnd: true }
  const delta = (dtMs / baseMs) * span * speed
  const next = current + delta
  if (next >= endTime) return { time: endTime, atEnd: true }
  return { time: next, atEnd: false }
}
