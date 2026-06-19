import { writable, get, type Writable } from 'svelte/store'
import type { TraceSummary } from '../lib/types'
import { nextPlayhead } from '../lib/playback'

export interface TraceStore {
  summary: Writable<TraceSummary | null>
  playhead: Writable<number>
  playing: Writable<boolean>
  speed: Writable<number>
  showSystem: Writable<boolean>
  loadSummary(s: TraceSummary): void
  setPlayhead(t: number): void
  play(): void
  pause(): void
  toggle(): void
  setSpeed(n: number): void
  setShowSystem(v: boolean): void
  advance(dtMs: number): void
}

// createTraceStore holds the loaded trace, the playhead, and playback/filter
// state. The playhead is always clamped to [startTime, endTime]. Playback is
// driven by requestAnimationFrame, but the per-frame step (advance) is a plain
// method so it can be unit-tested without a real animation frame.
export function createTraceStore(): TraceStore {
  const summary = writable<TraceSummary | null>(null)
  const playhead = writable<number>(0)
  const playing = writable<boolean>(false)
  const speed = writable<number>(1)
  const showSystem = writable<boolean>(false)
  let current: TraceSummary | null = null
  let rafId = 0
  let lastFrame = 0

  function clampSet(t: number) {
    if (!current) return
    playhead.set(Math.min(current.endTime, Math.max(current.startTime, t)))
  }

  function stopRaf() {
    if (rafId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId)
    rafId = 0
  }

  function frame(now: number) {
    const dt = lastFrame === 0 ? 16 : now - lastFrame
    lastFrame = now
    api.advance(dt)
    if (get(playing) && typeof requestAnimationFrame !== 'undefined') {
      rafId = requestAnimationFrame(frame)
    }
  }

  const api: TraceStore = {
    summary,
    playhead,
    playing,
    speed,
    showSystem,
    loadSummary(s) {
      current = s
      summary.set(s)
      playhead.set(s.startTime)
      api.pause()
    },
    setPlayhead(t) {
      clampSet(t)
    },
    play() {
      if (!current) return
      // Restart from the beginning if parked at the end.
      if (get(playhead) >= current.endTime) playhead.set(current.startTime)
      playing.set(true)
      lastFrame = 0
      if (typeof requestAnimationFrame !== 'undefined') rafId = requestAnimationFrame(frame)
    },
    pause() {
      playing.set(false)
      stopRaf()
    },
    toggle() {
      get(playing) ? api.pause() : api.play()
    },
    setSpeed(n) {
      speed.set(n)
    },
    setShowSystem(v) {
      showSystem.set(v)
    },
    advance(dtMs) {
      if (!current) return
      const r = nextPlayhead(get(playhead), dtMs, get(speed), current.startTime, current.endTime)
      playhead.set(r.time)
      if (r.atEnd) api.pause()
    },
  }
  return api
}

// The app-wide singleton store.
export const traceStore = createTraceStore()
