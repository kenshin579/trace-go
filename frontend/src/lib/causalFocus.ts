import type { CausalEdge } from './types'

// causalNeighbors returns the 1-hop causal chain of a selected goroutine: itself
// plus every goroutine directly linked by a causal edge (incoming or outgoing).
// Time-independent — computed once from the full edge set, so the focus set does
// not change as the playhead moves.
export function causalNeighbors(edges: CausalEdge[], selectedId: number): Set<number> {
  const set = new Set<number>([selectedId])
  for (const e of edges) {
    if (e.from === selectedId) set.add(e.to) // selected woke e.to
    if (e.to === selectedId) set.add(e.from) // e.from woke selected
  }
  return set
}
