import { describe, it, expect } from 'vitest'
import { intervalTooltip, nodeTooltip, edgeTooltip } from './tooltip'

describe('intervalTooltip', () => {
  it('shows label, state, and block reason for a blocked interval', () => {
    expect(intervalTooltip('main.worker', 'blocked', 'chan receive')).toBe(
      'main.worker\nblocked · chan receive',
    )
  })
  it('omits the reason when running/runnable or reason is empty', () => {
    expect(intervalTooltip('main.a', 'running', '')).toBe('main.a\nrunning')
    expect(intervalTooltip('g5', 'blocked', '')).toBe('g5\nblocked')
  })
})

describe('nodeTooltip', () => {
  it('shows the goroutine and its state at the playhead', () => {
    expect(nodeTooltip('main.a', 'running')).toBe('main.a\nrunning')
  })
  it('says not-alive when the state is null', () => {
    expect(nodeTooltip('g9', null)).toBe('g9\nnot running at this time')
  })
})

describe('edgeTooltip', () => {
  it('labels the relation as inferred (no channel identity in the trace)', () => {
    expect(edgeTooltip('channel', 'g1', 'g2')).toBe('g1 → g2\nchannel communication (inferred)')
    expect(edgeTooltip('mutex', 'main.a', 'g3')).toBe('main.a → g3\nmutex synchronization (inferred)')
    expect(edgeTooltip('other', 'g1', 'g2')).toBe('g1 → g2\nunblock (inferred)')
  })
})

import { regionTooltip, logTooltip, taskTooltip } from './tooltip'

describe('regionTooltip', () => {
  it('shows the region name and its duration in ms', () => {
    expect(regionTooltip('db-query', 1_000_000, 4_000_000)).toBe('db-query\n3.000 ms')
  })
})

describe('logTooltip', () => {
  it('shows category then message', () => {
    expect(logTooltip('cache', 'miss')).toBe('cache\nmiss')
  })
})

describe('taskTooltip', () => {
  it('shows the task name and duration in ms', () => {
    expect(taskTooltip('request', 0, 2_000_000)).toBe('request\n2.000 ms')
  })
})
