import { describe, it, expect } from 'vitest'
import { isSystemGoroutine, visibleGoroutines } from './filter'
import type { TraceSummary } from './types'

describe('isSystemGoroutine', () => {
  it('flags runtime.* and runtime/* goroutines', () => {
    expect(isSystemGoroutine({ id: 2, name: 'runtime.forcegchelper' })).toBe(true)
    expect(isSystemGoroutine({ id: 3, name: 'runtime.bgsweep' })).toBe(true)
    expect(isSystemGoroutine({ id: 21, name: 'runtime/trace.(*traceMultiplexer).startLocked.func1' })).toBe(true)
  })

  it('does NOT flag the main goroutine (empty name) or user goroutines', () => {
    expect(isSystemGoroutine({ id: 1, name: '' })).toBe(false)
    expect(isSystemGoroutine({ id: 22, name: 'main.main.func1' })).toBe(false)
  })
})

describe('visibleGoroutines', () => {
  const summary = {
    startTime: 0,
    endTime: 100,
    goroutines: [
      { id: 1, name: '', createdAt: 0, endedAt: 100, intervals: [] },
      { id: 2, name: 'runtime.bgsweep', createdAt: 0, endedAt: 0, intervals: [] },
      { id: 22, name: 'main.main.func1', createdAt: 0, endedAt: 100, intervals: [] },
    ],
    edges: [],
  } as TraceSummary

  it('hides system goroutines when showSystem is false', () => {
    const v = visibleGoroutines(summary, false)
    expect(v.map((g) => g.id)).toEqual([1, 22])
  })

  it('returns all goroutines when showSystem is true', () => {
    const v = visibleGoroutines(summary, true)
    expect(v.map((g) => g.id)).toEqual([1, 2, 22])
  })
})
