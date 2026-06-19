import { describe, it, expect } from 'vitest'
import { get } from 'svelte/store'
import { createTraceStore } from './trace'
import type { TraceSummary } from '../lib/types'

const summary: TraceSummary = {
  startTime: 100,
  endTime: 200,
  goroutines: [{ id: 1, name: 'a', createdAt: 100, endedAt: 200, intervals: [] }],
  edges: [],
}

describe('createTraceStore', () => {
  it('starts empty', () => {
    const s = createTraceStore()
    expect(get(s.summary)).toBeNull()
  })

  it('loadSummary sets the summary and resets the playhead to startTime', () => {
    const s = createTraceStore()
    s.loadSummary(summary)
    expect(get(s.summary)).toEqual(summary)
    expect(get(s.playhead)).toBe(100)
  })

  it('setPlayhead clamps to [startTime, endTime]', () => {
    const s = createTraceStore()
    s.loadSummary(summary)
    s.setPlayhead(50)
    expect(get(s.playhead)).toBe(100)
    s.setPlayhead(999)
    expect(get(s.playhead)).toBe(200)
    s.setPlayhead(150)
    expect(get(s.playhead)).toBe(150)
  })

  it('setPlayhead is a no-op when no summary is loaded', () => {
    const s = createTraceStore()
    s.setPlayhead(150)
    expect(get(s.playhead)).toBe(0)
  })
})

describe('createTraceStore playback', () => {
  const summary = {
    startTime: 0,
    endTime: 1000,
    goroutines: [{ id: 1, name: 'a', createdAt: 0, endedAt: 1000, intervals: [] }],
    edges: [],
  } as TraceSummary

  it('defaults: not playing, speed 1, system hidden', () => {
    const s = createTraceStore()
    expect(get(s.playing)).toBe(false)
    expect(get(s.speed)).toBe(1)
    expect(get(s.showSystem)).toBe(false)
  })

  it('toggle play requires a loaded summary', () => {
    const s = createTraceStore()
    s.play()
    expect(get(s.playing)).toBe(false) // nothing loaded -> stays paused
    s.loadSummary(summary)
    s.play()
    expect(get(s.playing)).toBe(true)
    s.pause()
    expect(get(s.playing)).toBe(false)
  })

  it('advance moves the playhead and auto-pauses at the end', () => {
    const s = createTraceStore()
    s.loadSummary(summary)
    s.play()
    s.setSpeed(1)
    s.advance(2000) // half of BASE_PLAY_MS(4000) at 1x -> ~500
    expect(get(s.playhead)).toBeCloseTo(500)
    expect(get(s.playing)).toBe(true)
    s.advance(10000) // overshoot -> clamps to end and pauses
    expect(get(s.playhead)).toBe(1000)
    expect(get(s.playing)).toBe(false)
  })

  it('play() from the end restarts at startTime', () => {
    const s = createTraceStore()
    s.loadSummary(summary)
    s.setPlayhead(1000) // at end
    s.play()
    expect(get(s.playhead)).toBe(0) // reset to start before playing
    expect(get(s.playing)).toBe(true)
  })

  it('setShowSystem updates the flag', () => {
    const s = createTraceStore()
    s.setShowSystem(true)
    expect(get(s.showSystem)).toBe(true)
  })

  it('play() is idempotent: calling it while already playing schedules one frame', () => {
    const g = globalThis as unknown as {
      requestAnimationFrame?: (cb: FrameRequestCallback) => number
      cancelAnimationFrame?: (id: number) => void
    }
    const savedReq = g.requestAnimationFrame
    const savedCancel = g.cancelAnimationFrame
    let scheduled = 0
    g.requestAnimationFrame = () => ++scheduled // do not invoke cb -> no real loop
    g.cancelAnimationFrame = () => {}
    try {
      const s = createTraceStore()
      s.loadSummary(summary)
      s.play()
      s.play() // second call must be ignored (already playing)
      expect(scheduled).toBe(1)
      expect(get(s.playing)).toBe(true)
    } finally {
      g.requestAnimationFrame = savedReq
      g.cancelAnimationFrame = savedCancel
    }
  })
})

describe('createTraceStore selection', () => {
  it('defaults to no selection', () => {
    const s = createTraceStore()
    expect(get(s.selectedId)).toBeNull()
  })
  it('setSelected sets and clears the selection', () => {
    const s = createTraceStore()
    s.setSelected(7)
    expect(get(s.selectedId)).toBe(7)
    s.setSelected(null)
    expect(get(s.selectedId)).toBeNull()
  })
  it('toggleSelected toggles the same id off and switches to a new one', () => {
    const s = createTraceStore()
    s.toggleSelected(7)
    expect(get(s.selectedId)).toBe(7)
    s.toggleSelected(7) // same -> clear
    expect(get(s.selectedId)).toBeNull()
    s.toggleSelected(7)
    s.toggleSelected(9) // different -> switch
    expect(get(s.selectedId)).toBe(9)
  })
})
