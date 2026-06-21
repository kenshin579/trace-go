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

describe('layoutTimeline topOffset', () => {
  const summary = {
    startTime: 0, endTime: 100,
    goroutines: [{ id: 1, name: 'a', createdAt: 0, endedAt: 100, intervals: [{ start: 0, end: 100, state: 'running', blockReason: '' }] }],
    edges: [],
  } as any

  it('starts the first lane below the top offset', () => {
    const lanes = layoutTimeline(summary, { width: 200, laneHeight: 18, laneGap: 4, topOffset: 30 })
    expect(lanes[0].y).toBe(30)
  })
  it('defaults to no offset', () => {
    const lanes = layoutTimeline(summary, { width: 200, laneHeight: 18, laneGap: 4 })
    expect(lanes[0].y).toBe(0)
  })
})

describe('layoutTimeline regions and logs', () => {
  const summary = {
    startTime: 0,
    endTime: 100,
    goroutines: [
      {
        id: 1, name: 'a', createdAt: 0, endedAt: 100,
        intervals: [{ start: 0, end: 100, state: 'running', blockReason: '' }],
        regions: [
          { start: 0, end: 60, name: 'outer', depth: 0 },
          { start: 10, end: 40, name: 'inner', depth: 1 },
        ],
      },
      {
        id: 2, name: 'b', createdAt: 0, endedAt: 100,
        intervals: [{ start: 0, end: 100, state: 'running', blockReason: '' }],
      },
    ],
    logs: [{ time: 50, goId: 1, category: 'c', message: 'm' }],
  } as any

  const opts = { width: 200, laneHeight: 18, laneGap: 4, gutter: 0, regionRowH: 8 }

  it('grows a lane with regions by (maxDepth+1) region rows, leaves others compact', () => {
    const lanes = layoutTimeline(summary, opts)
    // lane 0 has regions up to depth 1 -> 2 region rows: height = 18 + 2*8 = 34
    expect(lanes[0].height).toBe(18) // state row height stays laneHeight
    expect(lanes[0].totalHeight).toBe(34)
    // lane 1 has no regions -> compact
    expect(lanes[1].totalHeight).toBe(18)
  })

  it('stacks lanes by cumulative total height + gap', () => {
    const lanes = layoutTimeline(summary, opts)
    expect(lanes[0].y).toBe(0)
    expect(lanes[1].y).toBe(34 + 4) // lane0 totalHeight + gap
  })

  it('maps region spans to x/width and carries depth + name', () => {
    const lanes = layoutTimeline(summary, opts)
    const inner = lanes[0].regions.find((r) => r.name === 'inner')!
    expect(inner.depth).toBe(1)
    expect(inner.x).toBe(20) // t=10 of span 100 over width 200
    expect(inner.width).toBeCloseTo(60) // (40-10)/100 * 200
  })

  it('places log markers for the owning goroutine at the log time', () => {
    const lanes = layoutTimeline(summary, opts)
    expect(lanes[0].logs).toHaveLength(1)
    expect(lanes[0].logs[0].x).toBe(100) // t=50 of span 100 over width 200
    expect(lanes[1].logs).toHaveLength(0)
  })
})

import { layoutTimelineRows, hitGroupHeader, GROUP_HEADER_H } from './timelineLayout'
import { groupGoroutines } from './grouping'

describe('layoutTimelineRows', () => {
  const mk = (id: number, name: string) => ({
    id, name, createdAt: 0, endedAt: 100,
    intervals: [{ start: 0, end: 100, state: 'running', blockReason: '' }],
  })
  const summary = (gs: any[]) => ({ startTime: 0, endTime: 100, goroutines: gs, edges: [] }) as any
  const opts = { width: 200, laneHeight: 18, laneGap: 2 }

  it('emits a header row plus member lane rows for an expanded group', () => {
    const gs = [mk(1, 'main.w'), mk(2, 'main.w')] as any[]
    const rows = layoutTimelineRows(summary(gs), groupGoroutines(gs), new Set<string>(), opts)
    expect(rows.map((r) => r.kind)).toEqual(['header', 'lane', 'lane'])
    const header = rows[0] as Extract<typeof rows[number], { kind: 'header' }>
    expect(header.name).toBe('main.w')
    expect(header.count).toBe(2)
    expect(header.collapsed).toBe(false)
    expect(header.y).toBe(0)
    expect(header.height).toBe(GROUP_HEADER_H)
    expect((rows[1] as any).y).toBe(GROUP_HEADER_H + opts.laneGap)
  })

  it('emits only the header row for a collapsed group', () => {
    const gs = [mk(1, 'main.w'), mk(2, 'main.w')] as any[]
    const rows = layoutTimelineRows(summary(gs), groupGoroutines(gs), new Set(['main.w']), opts)
    expect(rows.map((r) => r.kind)).toEqual(['header'])
    expect((rows[0] as any).collapsed).toBe(true)
  })

  it('emits a bare lane row (no header) for a solo goroutine', () => {
    const gs = [mk(1, 'main.solo')] as any[]
    const rows = layoutTimelineRows(summary(gs), groupGoroutines(gs), new Set<string>(), opts)
    expect(rows.map((r) => r.kind)).toEqual(['lane'])
    expect((rows[0] as any).label).toBe('main.solo')
    expect((rows[0] as any).y).toBe(0)
  })

  it('maps lane geometry like layoutTimeline (x/width over the span)', () => {
    const gs = [mk(1, 'main.solo')] as any[]
    const rows = layoutTimelineRows(summary(gs), groupGoroutines(gs), new Set<string>(), opts)
    const lane = rows[0] as any
    expect(lane.rects[0].x).toBe(0)
    expect(lane.rects[0].width).toBe(200) // full span
  })
})

describe('hitGroupHeader', () => {
  const rows = [
    { kind: 'header', key: 'main.w', name: 'main.w', count: 2, collapsed: false, y: 0, height: 16 },
    { kind: 'lane', goroutineId: 1, y: 18, totalHeight: 18 },
  ] as any

  it('returns the header key when y is within a header row', () => {
    expect(hitGroupHeader(rows, 8)).toBe('main.w')
  })
  it('returns null when y is over a lane row', () => {
    expect(hitGroupHeader(rows, 25)).toBeNull()
  })
  it('returns null when y is past all rows', () => {
    expect(hitGroupHeader(rows, 999)).toBeNull()
  })
})
