import { describe, it, expect } from 'vitest'
import { clusterByTask, convexHull } from './graphCluster'
import type { Goroutine } from './types'

describe('clusterByTask', () => {
  const goroutines: Goroutine[] = [
    { id: 1, name: 'a', createdAt: 0, endedAt: 0, intervals: [], regions: [{ start: 0, end: 9, name: 'r', depth: 0, task: 5 }] },
    { id: 2, name: 'b', createdAt: 0, endedAt: 0, intervals: [], regions: [{ start: 0, end: 9, name: 'r', depth: 0, task: 9 }] },
    { id: 3, name: 'c', createdAt: 0, endedAt: 0, intervals: [], regions: [] }, // no task region
  ]
  it('assigns each goroutine to its first known-task region', () => {
    const m = clusterByTask(goroutines, new Set([5, 9]))
    expect(m.get(1)).toBe(5)
    expect(m.get(2)).toBe(9)
    expect(m.has(3)).toBe(false)
  })
  it('ignores regions whose task is not a known task', () => {
    const m = clusterByTask(goroutines, new Set([5])) // 9 not known
    expect(m.get(1)).toBe(5)
    expect(m.has(2)).toBe(false)
  })
})

describe('convexHull', () => {
  it('returns the boundary of a point set', () => {
    const hull = convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]])
    // interior point (5,5) excluded; 4 corners remain
    expect(hull).toHaveLength(4)
  })
  it('passes through <3 points unchanged', () => {
    expect(convexHull([[1, 2], [3, 4]])).toHaveLength(2)
  })
})
