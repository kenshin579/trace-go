import { describe, it, expect } from 'vitest'
import { layoutTaskTrack } from './taskTrack'
import type { Task } from './types'

const tasks: Task[] = [
  { id: 1, parent: 0, name: 'request', start: 0, end: 100 },
  { id: 2, parent: 1, name: 'db-batch', start: 20, end: 60 },
]

describe('layoutTaskTrack', () => {
  const opts = { width: 200, gutter: 0, startTime: 0, endTime: 100, taskRowH: 14 }

  it('maps task spans to x/width and computes parent depth', () => {
    const { bars, height } = layoutTaskTrack(tasks, opts)
    const root = bars.find((b) => b.name === 'request')!
    const child = bars.find((b) => b.name === 'db-batch')!
    expect(root.depth).toBe(0)
    expect(child.depth).toBe(1)
    expect(child.x).toBe(40) // t=20 over span 100, width 200
    expect(child.width).toBeCloseTo(80) // (60-20)/100*200
    expect(height).toBe(2 * 14) // maxDepth(1)+1 rows
  })

  it('returns zero height for no tasks', () => {
    const { bars, height } = layoutTaskTrack([], opts)
    expect(bars).toEqual([])
    expect(height).toBe(0)
  })
})
