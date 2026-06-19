import { describe, it, expect } from 'vitest'
import { edgesCrossed, cometPoint, FLASH_MS, MAX_PARTICLES } from './flash'
import type { CausalEdge } from './types'

const edges: CausalEdge[] = [
  { from: 1, to: 2, time: 10, category: 'channel' },
  { from: 2, to: 3, time: 20, category: 'mutex' },
  { from: 3, to: 1, time: 30, category: 'other' },
]

describe('edgesCrossed', () => {
  it('returns edges with prevT < time <= nowT (forward)', () => {
    expect(edgesCrossed(edges, 5, 20).map((e) => e.time)).toEqual([10, 20])
  })
  it('is start-exclusive, end-inclusive', () => {
    expect(edgesCrossed(edges, 10, 20).map((e) => e.time)).toEqual([20]) // 10 excluded, 20 included
  })
  it('returns nothing when not moving forward', () => {
    expect(edgesCrossed(edges, 20, 20)).toEqual([])
    expect(edgesCrossed(edges, 30, 5)).toEqual([])
  })
})

describe('cometPoint', () => {
  it('lerps along the segment by progress', () => {
    expect(cometPoint(0, 0, 0, 100, 50)).toEqual({ x: 0, y: 0 })
    expect(cometPoint(1, 0, 0, 100, 50)).toEqual({ x: 100, y: 50 })
    expect(cometPoint(0.5, 0, 0, 100, 50)).toEqual({ x: 50, y: 25 })
  })
  it('clamps progress to [0,1]', () => {
    expect(cometPoint(-1, 0, 0, 100, 0)).toEqual({ x: 0, y: 0 })
    expect(cometPoint(2, 0, 0, 100, 0)).toEqual({ x: 100, y: 0 })
  })
})

describe('constants', () => {
  it('are sane', () => {
    expect(FLASH_MS).toBeGreaterThan(0)
    expect(MAX_PARTICLES).toBeGreaterThan(0)
  })
})
