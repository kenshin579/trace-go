import { describe, it, expect } from 'vitest'
import { hitTimeline, nodeAtPoint, distToSegment } from './hit'
import type { Lane } from './timelineLayout'

const laneA: Lane = {
  goroutineId: 1, label: 'a', y: 0, height: 18, totalHeight: 26,
  rects: [{ x: 0, width: 100, state: 'running', color: '#0a0', blockReason: '' }],
  regions: [{ x: 10, width: 40, depth: 0, name: 'db', start: 100, end: 500 }],
  logs: [{ x: 70, category: 'c', message: 'm' }],
}
const laneB: Lane = {
  goroutineId: 2, label: 'b', y: 30, height: 18, totalHeight: 18,
  rects: [{ x: 0, width: 100, state: 'running', color: '#0a0', blockReason: '' }],
  regions: [], logs: [],
}
const lanes = [laneA, laneB]

describe('hitTimeline', () => {
  const RR = 8 // regionRowH

  it('hits a state interval in the state row', () => {
    const h = hitTimeline(lanes, 50, 5, RR)
    expect(h?.kind).toBe('interval')
    expect(h?.kind === 'interval' && h.rect.width).toBe(100)
  })
  it('hits a log marker near its x in the state row', () => {
    const h = hitTimeline(lanes, 71, 4, RR)
    expect(h?.kind).toBe('log')
    expect(h?.kind === 'log' && h.log.message).toBe('m')
  })
  it('hits a region in the region row below the state row', () => {
    const h = hitTimeline(lanes, 30, 22, RR) // y in [18, 26) -> depth 0 region row
    expect(h?.kind).toBe('region')
    expect(h?.kind === 'region' && h.region.name).toBe('db')
  })
  it('returns null in the gap between lanes', () => {
    expect(hitTimeline(lanes, 50, 28, RR)).toBeNull() // y 26..30 is the gap
  })
  it('resolves the second lane by its own y range', () => {
    const h = hitTimeline(lanes, 50, 35, RR)
    expect(h?.kind).toBe('interval')
    expect(h?.lane.goroutineId).toBe(2)
  })
})

describe('nodeAtPoint', () => {
  const nodes = [
    { id: 1, label: 'a', x: 100, y: 100 },
    { id: 2, label: 'b', x: 200, y: 100 },
  ]
  it('finds a node within the radius', () => {
    expect(nodeAtPoint(nodes, 104, 103, 10)?.id).toBe(1)
  })
  it('returns undefined when no node is close', () => {
    expect(nodeAtPoint(nodes, 150, 150, 10)).toBeUndefined()
  })
})

describe('distToSegment', () => {
  it('is the perpendicular distance to a horizontal segment', () => {
    expect(distToSegment(50, 10, 0, 0, 100, 0)).toBeCloseTo(10)
  })
  it('clamps to the nearest endpoint past the segment', () => {
    expect(distToSegment(-30, 0, 0, 0, 100, 0)).toBeCloseTo(30)
  })
})
