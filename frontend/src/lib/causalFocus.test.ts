import { describe, it, expect } from 'vitest'
import { causalNeighbors } from './causalFocus'
import type { CausalEdge } from './types'

const edges: CausalEdge[] = [
  { from: 1, to: 2, time: 10, category: 'channel' }, // 1 woke 2
  { from: 3, to: 1, time: 20, category: 'mutex' },   // 3 woke 1
  { from: 4, to: 5, time: 30, category: 'other' },   // unrelated
]

describe('causalNeighbors', () => {
  it('includes self plus direct incoming and outgoing neighbors', () => {
    const s = causalNeighbors(edges, 1)
    expect([...s].sort((a, b) => a - b)).toEqual([1, 2, 3]) // self=1, outgoing to 2, incoming from 3
  })
  it('ignores unrelated edges', () => {
    const s = causalNeighbors(edges, 1)
    expect(s.has(4)).toBe(false)
    expect(s.has(5)).toBe(false)
  })
  it('returns just the node when it has no causal edges', () => {
    expect([...causalNeighbors(edges, 9)]).toEqual([9])
  })
  it('adds the to-neighbor when selected is the from side', () => {
    expect(causalNeighbors([{ from: 7, to: 8, time: 0, category: 'channel' }], 7).has(8)).toBe(true)
  })
  it('adds the from-neighbor when selected is the to side', () => {
    expect(causalNeighbors([{ from: 7, to: 8, time: 0, category: 'channel' }], 8).has(7)).toBe(true)
  })
  it('returns just the selected node when the edge list is empty', () => {
    expect([...causalNeighbors([], 42)]).toEqual([42])
  })
})
