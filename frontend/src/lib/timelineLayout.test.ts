import { describe, it, expect } from 'vitest'
import { layoutTimeline } from './timelineLayout'
import type { TraceSummary } from './types'

const summary: TraceSummary = {
  startTime: 0,
  endTime: 100,
  goroutines: [
    {
      id: 1,
      name: 'main.a',
      createdAt: 0,
      endedAt: 100,
      intervals: [
        { start: 0, end: 40, state: 'running', blockReason: '' },
        { start: 40, end: 100, state: 'blocked', blockReason: 'chan receive' },
      ],
    },
    {
      id: 2,
      name: '',
      createdAt: 10,
      endedAt: 0, // never ended -> extends to endTime
      intervals: [{ start: 10, end: 60, state: 'running', blockReason: '' }],
    },
  ],
  edges: [],
}

describe('layoutTimeline', () => {
  it('produces one lane per goroutine with stacked y positions', () => {
    const lanes = layoutTimeline(summary, { width: 200, laneHeight: 20, laneGap: 4 })
    expect(lanes).toHaveLength(2)
    expect(lanes[0].label).toBe('main.a')
    expect(lanes[1].label).toBe('g2') // empty name fallback
    expect(lanes[0].y).toBe(0)
    expect(lanes[1].y).toBe(24) // laneHeight + laneGap
  })

  it('maps interval times to pixel x/width across the full trace span', () => {
    const lanes = layoutTimeline(summary, { width: 200, laneHeight: 20, laneGap: 4 })
    const first = lanes[0].rects[0]
    expect(first.x).toBe(0) // t=0 -> 0px
    expect(first.width).toBe(80) // 40/100 * 200
    const second = lanes[0].rects[1]
    expect(second.x).toBe(80) // t=40 -> 80px
    expect(second.blockReason).toBe('chan receive')
  })

  it('never emits negative or zero-floored widths for tiny intervals', () => {
    const tiny: TraceSummary = {
      startTime: 0,
      endTime: 1_000_000,
      goroutines: [
        {
          id: 1,
          name: 'x',
          createdAt: 0,
          endedAt: 1_000_000,
          intervals: [{ start: 0, end: 1, state: 'running', blockReason: '' }],
        },
      ],
      edges: [],
    }
    const lanes = layoutTimeline(tiny, { width: 1000, laneHeight: 20, laneGap: 4 })
    expect(lanes[0].rects[0].width).toBeGreaterThanOrEqual(1)
  })
})

describe('layoutTimeline gutter', () => {
  const summary = {
    startTime: 0,
    endTime: 100,
    goroutines: [
      { id: 1, name: 'a', createdAt: 0, endedAt: 100, intervals: [{ start: 0, end: 50, state: 'running', blockReason: '' }] },
    ],
    edges: [],
  } as any

  it('offsets the time axis to start at the gutter', () => {
    const lanes = layoutTimeline(summary, { width: 200, laneHeight: 20, laneGap: 4, gutter: 50 })
    // t=0 maps to x=gutter; t=50 (half of span 100) maps to gutter + half of (200-50)=125.
    expect(lanes[0].rects[0].x).toBe(50)
    expect(lanes[0].rects[0].width).toBeCloseTo(75)
  })

  it('defaults to no gutter when omitted', () => {
    const lanes = layoutTimeline(summary, { width: 200, laneHeight: 20, laneGap: 4 })
    expect(lanes[0].rects[0].x).toBe(0)
  })
})
