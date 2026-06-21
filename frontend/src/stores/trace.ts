import { writable, get, type Writable } from 'svelte/store'
import type { TraceSummary } from '../lib/types'
import { nextPlayhead } from '../lib/playback'

// dt seed for the first animation frame after play/resume (~one 60fps frame).
const SEED_FRAME_MS = 16

export interface TraceStore {
  summary: Writable<TraceSummary | null>
  playhead: Writable<number>
  playing: Writable<boolean>
  speed: Writable<number>
  showSystem: Writable<boolean>
  selectedId: Writable<number | null>
  collapsedGroups: Writable<Set<string>>
  loadSummary(s: TraceSummary): void
  setPlayhead(t: number): void
  play(): void
  pause(): void
  toggle(): void
  setSpeed(n: number): void
  setShowSystem(v: boolean): void
  advance(dtMs: number): void
  setSelected(id: number | null): void
  toggleSelected(id: number): void
  toggleGroup(key: string): void
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
  const selectedId = writable<number | null>(null)
  const collapsedGroups = writable<Set<string>>(new Set())
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
    // On the first frame after play()/resume there is no previous timestamp, so
    // seed dt with one ~60fps frame instead of a huge now-0 jump.
    const dt = lastFrame === 0 ? SEED_FRAME_MS : now - lastFrame
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
    selectedId,
    collapsedGroups,
    loadSummary(s) {
      current = s
      summary.set(s)
      playhead.set(s.startTime)
      api.pause()
      collapsedGroups.set(new Set())
    },
    setPlayhead(t) {
      clampSet(t)
    },
    play() {
      // Idempotent: ignore if nothing is loaded or a frame loop is already running
      // (prevents orphaning a scheduled rAF and double-stepping the playhead).
      if (!current || get(playing)) return
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
    setSelected(id) {
      selectedId.set(id)
    },
    toggleSelected(id) {
      selectedId.update((cur) => (cur === id ? null : id))
    },
    toggleGroup(key) {
      collapsedGroups.update((cur) => {
        const next = new Set(cur)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
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
