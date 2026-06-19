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
