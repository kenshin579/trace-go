import { goroutineLabel } from './format'
import type { GraphNode, GraphLink } from './graphModel'
import type { Goroutine, CausalEdge } from './types'
import type { GoroutineGroup } from './grouping'

export interface CollapsedGraph {
  nodes: GraphNode[] // individual nodes + one super-node per collapsed group
  links: GraphLink[] // rerouted + deduped edges
  remap: Map<number, number> // original goroutine id -> display node id (member -> super-node)
}

// collapseGraph merges each collapsed group's members into one super-node and
// reroutes edges through an id remap. Node-set changes, so callers run it only on
// rebuild (never on playhead). With an empty collapsedKeys the result equals a
// plain model: every goroutine is its own node and remap is empty.
export function collapseGraph(
  goroutines: Goroutine[],
  edges: CausalEdge[],
  groups: GoroutineGroup[],
  collapsedKeys: Set<string>,
): CollapsedGraph {
  const ids = new Set(goroutines.map((gr) => gr.id))
  const remap = new Map<number, number>()
  const nodes: GraphNode[] = []
  let nextSuperId = -1

  for (const group of groups) {
    const collapsed = group.members.length >= 2 && collapsedKeys.has(group.key)
    if (collapsed) {
      const superId = nextSuperId--
      const memberIds = group.members.map((m) => m.id)
      for (const id of memberIds) remap.set(id, superId)
      nodes.push({
        id: superId,
        label: `${group.name} ×${group.members.length}`,
        group: { key: group.key, name: group.name, count: group.members.length, memberIds },
      })
    } else {
      for (const m of group.members) nodes.push({ id: m.id, label: goroutineLabel(m) })
    }
  }

  // Reroute edges through remap (members -> their super-node), drop self-loops
  // (intra-group), drop edges to goroutines outside the visible set, and dedup.
  const toDisplay = (id: number) => remap.get(id) ?? id
  const seen = new Set<string>()
  const links: GraphLink[] = []
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue
    const from = toDisplay(e.from)
    const to = toDisplay(e.to)
    if (from === to) continue // intra-group (or self) edge
    const key = `${from}->${to}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ source: from, target: to, category: e.category })
  }
  return { nodes, links, remap }
}
