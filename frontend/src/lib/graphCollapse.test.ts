import { describe, it, expect } from 'vitest'
import { collapseGraph } from './graphCollapse'
import { groupGoroutines } from './grouping'
import type { Goroutine, CausalEdge } from './types'

function g(id: number, name: string): Goroutine {
  return { id, name, createdAt: 0, endedAt: 0, intervals: [] }
}

// 1 solo (main.a, id 1) + a 3-member worker group (main.w, ids 2,3,4) + external id 5.
const goroutines: Goroutine[] = [g(1, 'main.a'), g(2, 'main.w'), g(3, 'main.w'), g(4, 'main.w'), g(5, 'main.b')]
const groups = groupGoroutines(goroutines)

describe('collapseGraph', () => {
  it('with no collapsed groups is equivalent to a plain model (identity remap)', () => {
    const edges: CausalEdge[] = [{ from: 1, to: 2, time: 0, category: 'channel' }]
    const out = collapseGraph(goroutines, edges, groups, new Set<string>())
    expect(out.nodes).toHaveLength(5)
    expect(out.nodes.every((n) => n.group == null)).toBe(true)
    expect(out.remap.size).toBe(0)
    expect(out.links).toHaveLength(1)
    expect(out.links[0]).toMatchObject({ source: 1, target: 2 })
  })

  it('merges a collapsed group into one super-node with member ids', () => {
    const out = collapseGraph(goroutines, [], groups, new Set(['main.w']))
    expect(out.nodes).toHaveLength(3) // 5 - 3 members + 1 super-node
    const sup = out.nodes.find((n) => n.group != null)!
    expect(sup.group!.key).toBe('main.w')
    expect(sup.group!.count).toBe(3)
    expect(sup.group!.memberIds.slice().sort((a, b) => a - b)).toEqual([2, 3, 4])
    expect(out.remap.get(2)).toBe(sup.id)
    expect(out.remap.get(3)).toBe(sup.id)
    expect(out.remap.get(4)).toBe(sup.id)
    expect(sup.id).toBeLessThan(0) // synthetic id never collides with positive goroutine ids
    expect(sup.cluster).toBeUndefined()
  })

  it('reroutes external edges to the super-node and dedups parallels', () => {
    const edges: CausalEdge[] = [
      { from: 2, to: 5, time: 0, category: 'channel' },
      { from: 3, to: 5, time: 1, category: 'channel' }, // dedups with above into one super->5
      { from: 1, to: 4, time: 2, category: 'mutex' }, // 1 -> member 4 => 1 -> super
    ]
    const out = collapseGraph(goroutines, edges, groups, new Set(['main.w']))
    const sup = out.nodes.find((n) => n.group != null)!
    const keys = out.links.map((l) => `${l.source}->${l.target}`).sort()
    expect(keys).toEqual([`${sup.id}->5`, `1->${sup.id}`].sort())
  })

  it('drops intra-group edges (both endpoints in the same collapsed group)', () => {
    const edges: CausalEdge[] = [{ from: 2, to: 3, time: 0, category: 'channel' }]
    const out = collapseGraph(goroutines, edges, groups, new Set(['main.w']))
    expect(out.links).toHaveLength(0)
  })
})
