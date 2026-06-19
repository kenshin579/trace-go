import { describe, it, expect } from 'vitest'
import { goroutineLabel, effectiveEnd, stateColor, categoryColor } from './format'

describe('goroutineLabel', () => {
  it('uses the name when present', () => {
    expect(goroutineLabel({ id: 7, name: 'main.worker' })).toBe('main.worker')
  })
  it('falls back to g<id> when the name is empty', () => {
    expect(goroutineLabel({ id: 7, name: '' })).toBe('g7')
  })
})

describe('effectiveEnd', () => {
  it('returns endedAt when the goroutine ended', () => {
    expect(effectiveEnd({ endedAt: 900 }, 1000)).toBe(900)
  })
  it('returns the trace end when endedAt is the 0 sentinel', () => {
    expect(effectiveEnd({ endedAt: 0 }, 1000)).toBe(1000)
  })
})

describe('stateColor', () => {
  it('maps known states to distinct colors and falls back for unknown', () => {
    const r = stateColor('running')
    const b = stateColor('blocked')
    const u = stateColor('runnable')
    expect(new Set([r, b, u]).size).toBe(3)
    expect(typeof stateColor('???' as any)).toBe('string')
  })
})

describe('categoryColor', () => {
  it('maps each edge category to a distinct color', () => {
    const c = categoryColor('channel')
    const m = categoryColor('mutex')
    const o = categoryColor('other')
    expect(new Set([c, m, o]).size).toBe(3)
  })
  it('falls back to the channel color for an unknown category', () => {
    expect(typeof categoryColor('???' as any)).toBe('string')
  })
})
