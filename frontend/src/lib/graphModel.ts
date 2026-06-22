import type { Goroutine, CausalEdge, EdgeCategory } from './types'
import { goroutineLabel } from './format'

// GraphNode is a persistent node object. d3-force mutates x/y/vx/vy in place
// during simulation; we keep these optional and let the sim populate them.
export interface GraphNode {
  id: number
  label: string
  x?: number
  y?: number
  vx?: number
  vy?: number
  cluster?: number // task id this node is statically grouped under (set by the view)
  // Set on a super-node (a collapsed goroutine group); absent on individual nodes.
  group?: { key: string; name: string; count: number; memberIds: number[] }
}

export interface GraphLink {
  source: number
  target: number
  category: EdgeCategory
}

export interface GraphModel {
  nodes: GraphNode[]
  links: GraphLink[]
}

// buildGraphModel produces the persistent node/link sets for the force layout
// from the currently visible goroutines. Links are deduped per (from,to) pair
// and any edge referencing a goroutine outside the visible set is dropped.
export function buildGraphModel(goroutines: Goroutine[], edges: CausalEdge[]): GraphModel {
  const nodes: GraphNode[] = goroutines.map((g) => ({ id: g.id, label: goroutineLabel(g) }))
  const ids = new Set(nodes.map((n) => n.id))

  // Dedup is directional (from->to): A->B and B->A are kept as distinct edges.
  // When the same ordered pair fires repeatedly with different categories, the
  // FIRST occurrence's category wins for the persistent layout link (later ones
  // are dropped). Per-firing categories are still available via the raw edge
  // list (activeEdges) for time-localized emphasis.
  const seen = new Set<string>()
  const links: GraphLink[] = []
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue
    const key = `${e.from}->${e.to}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ source: e.from, target: e.to, category: e.category })
  }
  return { nodes, links }
}
