# trace-go Graph Super-Nodes (B6 Stage 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a goroutine group is collapsed (Stage 1, shared `collapsedGroups` store), merge its members into one super-node in the graph — rerouting edges, remapping comets, and keeping causal focus working — so timeline collapse and graph super-nodes stay in sync.

**Architecture:** A pure `collapseGraph(goroutines, edges, groups, collapsedKeys)` produces merged nodes (a super-node per collapsed group carrying `group.memberIds`), rerouted/deduped links, and an id `remap`. `GraphCanvas.rebuild` consumes it (keyed on `$collapsedGroups` — a legitimate node-set change like `$showSystem`), so the "no re-layout on playhead" invariant (2C) holds. Super-nodes render in a neutral color (no task-hull membership), expand on click, and stay bright in causal focus if any member is in the chain. Empty collapse set ⇒ identical to today.

**Tech Stack:** Svelte 3 + TypeScript, d3-force, Canvas 2D, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-22-graph-supernodes-design.md`.

---

## File Structure

- `frontend/src/lib/graphModel.ts` — **modify**: add `GraphNode.group?` optional field.
- `frontend/src/lib/graphCollapse.ts` (+ `.test.ts`) — **new**: `collapseGraph`, `CollapsedGraph`.
- `frontend/src/components/GraphCanvas.svelte` — **modify**: rebuild via `collapseGraph` keyed on collapsedGroups; super-node render/click/comet/focus.

**Note:** Tasks 1 & 2 are additive (optional field + new pure module), so the build stays green before the component migrates in Task 3.

---

## Task 1: GraphNode.group optional field

**Files:** Modify `frontend/src/lib/graphModel.ts`.

- [ ] **Step 1: Add the optional field**

In `frontend/src/lib/graphModel.ts`, add to the `GraphNode` interface (after the existing `cluster?: number` line):
```ts
  // Set on a super-node (a collapsed goroutine group); absent on individual nodes.
  group?: { key: string; name: string; count: number; memberIds: number[] }
```

- [ ] **Step 2: Verify the suite still passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- graphModel && npm run check
```
Expected: graphModel tests still pass (optional field, no behavior change); 0 check errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/graphModel.ts
git commit -m "feat(frontend): add group field to graph node (super-node marker)"
```

---

## Task 2: Pure collapseGraph

**Files:** Create `frontend/src/lib/graphCollapse.ts`; Test `frontend/src/lib/graphCollapse.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/graphCollapse.test.ts`:
```ts
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
    // 5 goroutines - 3 members + 1 super-node = 3 nodes
    expect(out.nodes).toHaveLength(3)
    const sup = out.nodes.find((n) => n.group != null)!
    expect(sup.group!.key).toBe('main.w')
    expect(sup.group!.count).toBe(3)
    expect(sup.group!.memberIds.sort((a, b) => a - b)).toEqual([2, 3, 4])
    // members all remap to the super-node id
    expect(out.remap.get(2)).toBe(sup.id)
    expect(out.remap.get(3)).toBe(sup.id)
    expect(out.remap.get(4)).toBe(sup.id)
    // the super-node id does not collide with a real (positive) goroutine id
    expect(sup.id).toBeLessThan(0)
    // super-node carries no task cluster
    expect(sup.cluster).toBeUndefined()
  })

  it('reroutes external edges to the super-node and dedups parallels', () => {
    // members 2 and 3 both unblock external node 5 -> one super->5 link
    const edges: CausalEdge[] = [
      { from: 2, to: 5, time: 0, category: 'channel' },
      { from: 3, to: 5, time: 1, category: 'channel' },
      { from: 1, to: 4, time: 2, category: 'mutex' }, // external 1 -> member 4 => 1 -> super
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- graphCollapse
```
Expected: FAIL — cannot find `./graphCollapse`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/graphCollapse.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- graphCollapse && npm run check
```
Expected: all tests PASS; 0 check errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/graphCollapse.ts frontend/src/lib/graphCollapse.test.ts
git commit -m "feat(frontend): pure collapseGraph (merge collapsed groups into super-nodes)"
```

---

## Task 3: GraphCanvas super-node integration (manual-verified)

Rebuild via `collapseGraph` keyed on `$collapsedGroups`; render super-nodes (neutral color + label, no hull), remap comets, expand-on-click, and keep causal focus working.

**Files:** Modify `frontend/src/components/GraphCanvas.svelte`.

- [ ] **Step 1: Imports + state + rebuild signature**

(a) Add the new lib imports after the existing `import { causalNeighbors } from '../lib/causalFocus'` line:
```svelte
  import { collapseGraph } from '../lib/graphCollapse'
  import { groupGoroutines } from '../lib/grouping'
```
(b) Add `collapsedGroups, toggleGroup` to the store destructure. Change:
```svelte
  const { summary, playhead, showSystem, selectedId } = traceStore
```
to:
```svelte
  const { summary, playhead, showSystem, selectedId, collapsedGroups, toggleGroup } = traceStore
```
(c) Add a neutral super-node color constant near `const GHOST_ALPHA = 0.15`:
```svelte
  const GROUP_NODE_COLOR = '#7a8290'
```
(d) Add a `remap` state field near `let nodeById = ...`:
```svelte
  let remap = new Map<number, number>()
```
(e) Change the rebuild reactive trigger to include `$collapsedGroups`. The current line is:
```svelte
  $: rebuild($summary ? visibleGoroutines($summary, $showSystem) : [], $summary?.edges ?? [])
```
Change it to:
```svelte
  $: rebuild($summary ? visibleGoroutines($summary, $showSystem) : [], $summary?.edges ?? [], $collapsedGroups)
```

- [ ] **Step 2: Use collapseGraph inside rebuild**

In `rebuild`, change the signature and the model-building lines. The current head of `rebuild` is:
```svelte
  function rebuild(goroutines: Goroutine[], edges: CausalEdge[]) {
    goroutineById = new Map(goroutines.map((g) => [g.id, g]))
    const model = buildGraphModel(goroutines, edges)
    nodes = model.nodes
    links = model.links
    nodeById = new Map(nodes.map((n) => [n.id, n]))
    const known = new Set(($summary?.tasks ?? []).map((t) => t.id))
    const clusters = clusterByTask(goroutines, known)
    for (const n of nodes) n.cluster = clusters.get(n.id)
```
Change it to:
```svelte
  function rebuild(goroutines: Goroutine[], edges: CausalEdge[], collapsedKeys: Set<string>) {
    goroutineById = new Map(goroutines.map((g) => [g.id, g]))
    const collapsed = collapseGraph(goroutines, edges, groupGoroutines(goroutines), collapsedKeys)
    nodes = collapsed.nodes
    links = collapsed.links
    remap = collapsed.remap
    nodeById = new Map(nodes.map((n) => [n.id, n]))
    const known = new Set(($summary?.tasks ?? []).map((t) => t.id))
    const clusters = clusterByTask(goroutines, known)
    // Cluster only individual nodes; super-nodes carry no task cluster (excluded from hulls).
    for (const n of nodes) n.cluster = n.group ? undefined : clusters.get(n.id)
```
(The rest of `rebuild` — `comets = []`, `prevT = null`, `sim?.stop()`, the `forceSimulation(...)` chain — stays unchanged. `buildGraphModel` is no longer used; remove it from the `../lib/graphModel` import, keeping `type GraphNode, type GraphLink`.)

So also change the import line:
```svelte
  import { buildGraphModel, type GraphNode, type GraphLink } from '../lib/graphModel'
```
to:
```svelte
  import type { GraphNode, GraphLink } from '../lib/graphModel'
```

- [ ] **Step 3: Remap comets**

In `onPlayheadChange`, the current edge-crossing loop body is:
```svelte
      for (const e of edgesCrossed($summary.edges, prevT, t)) {
        if (comets.length >= MAX_PARTICLES) break
        const a = nodeById.get(e.from)
        const b = nodeById.get(e.to)
        if (!a || !b) continue
        comets.push({ from: a, to: b, color: categoryColor(e.category), start: performance.now() })
      }
```
Change the node lookups to go through `remap` and skip intra-super-node crossings:
```svelte
      for (const e of edgesCrossed($summary.edges, prevT, t)) {
        if (comets.length >= MAX_PARTICLES) break
        const a = nodeById.get(remap.get(e.from) ?? e.from)
        const b = nodeById.get(remap.get(e.to) ?? e.to)
        if (!a || !b || a === b) continue // skip if either endpoint is hidden or both fold into one super-node
        comets.push({ from: a, to: b, color: categoryColor(e.category), start: performance.now() })
      }
```

- [ ] **Step 4: Render super-nodes + causal focus**

In `draw()`, replace the entire nodes loop. The current loop is:
```svelte
    // Nodes. In focus mode, non-chain nodes are ghosted; chain nodes keep their
    // state-at-t color and the selected node keeps its ring.
    for (const n of nodes) {
      if (n.x == null) continue
      const g = goroutineById.get(n.id)
      const st = g ? stateAt(g, t) : null
      ctx.globalAlpha = chain && !chain.has(n.id) ? GHOST_ALPHA : 1
      ctx.fillStyle = st ? stateColor(st) : DIM_COLOR // dim if not alive at t
      ctx.beginPath()
      ctx.arc(n.x, n.y!, 9, 0, Math.PI * 2)
      ctx.fill()
      if (n.id === $selectedId) {
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
```
Replace with (note the null-safe `inChain` — `chain.has` is never called when `chain` is null):
```svelte
    // Nodes. Super-nodes (collapsed groups) draw in a fixed neutral color with a
    // ring + label; individual nodes keep their state-at-t color. In focus mode a
    // super-node stays bright if any member is in the chain.
    ctx.font = '10px system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    for (const n of nodes) {
      if (n.x == null) continue
      const inChain = !chain ? true : n.group ? n.group.memberIds.some((id) => chain.has(id)) : chain.has(n.id)
      ctx.globalAlpha = inChain ? 1 : GHOST_ALPHA
      if (n.group) {
        ctx.fillStyle = GROUP_NODE_COLOR
        ctx.beginPath()
        ctx.arc(n.x, n.y!, 9, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.fillStyle = '#cdd3df'
        ctx.fillText(n.label, n.x + 12, n.y!)
      } else {
        const g = goroutineById.get(n.id)
        const st = g ? stateAt(g, t) : null
        ctx.fillStyle = st ? stateColor(st) : DIM_COLOR // dim if not alive at t
        ctx.beginPath()
        ctx.arc(n.x, n.y!, 9, 0, Math.PI * 2)
        ctx.fill()
        if (n.id === $selectedId) {
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 2
          ctx.stroke()
        }
      }
    }
    ctx.globalAlpha = 1
```

- [ ] **Step 5: Expand on super-node click + super-node tooltip**

(a) In `onClick`, the current body is:
```svelte
  function onClick(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect()
    const n = nodeAtPoint(nodes, e.clientX - rect.left, e.clientY - rect.top, 10)
    if (n) traceStore.toggleSelected(n.id)
  }
```
Change to expand a super-node instead of selecting it:
```svelte
  function onClick(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect()
    const n = nodeAtPoint(nodes, e.clientX - rect.left, e.clientY - rect.top, 10)
    if (!n) return
    if (n.group) toggleGroup(n.group.key) // clicking a super-node expands the group
    else traceStore.toggleSelected(n.id)
  }
```
(b) In `onPointerMove`, the node-hover branch is:
```svelte
    const n = nodeAtPoint(nodes, px, py, 10)
    if (n) {
      const g = goroutineById.get(n.id)
      tip = { text: nodeTooltip(n.label, g ? stateAt(g, $playhead) : null), x: px, y: py }
      return
    }
```
Change to show the group label for super-nodes:
```svelte
    const n = nodeAtPoint(nodes, px, py, 10)
    if (n) {
      if (n.group) {
        tip = { text: n.label, x: px, y: py }
      } else {
        const g = goroutineById.get(n.id)
        tip = { text: nodeTooltip(n.label, g ? stateAt(g, $playhead) : null), x: px, y: py }
      }
      return
    }
```

- [ ] **Step 6: Type-check, test, build**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm run check && npm test
cd /Users/user/GolandProjects/trace-go
wails build
```
Expected: 0 check errors; all unit suites pass; `wails build` succeeds. After build, revert spurious generated files: `git checkout -- frontend/dist/gitkeep frontend/wailsjs/runtime/`.

- [ ] **Step 7: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/components/GraphCanvas.svelte
git commit -m "feat(frontend): merge collapsed groups into graph super-nodes"
```

- [ ] **Step 8: Manual visual verification (human)**

Open a trace with a worker group (e.g. `~/Desktop/trace-tasks.out`: six `main.main.func2`). Run the app (`open build/bin/trace-go.app`), open the trace, then:
1. **Default (expanded)** — graph looks exactly as before: six individual `main.main.func2` nodes, task hulls, comets, causal focus all as today.
2. **Collapse in the timeline** — click the `▾ main.main.func2 ×6` timeline header. In the GRAPH, the six member nodes merge into ONE neutral-gray node labeled `main.main.func2 ×6`, with a white ring. Edges that went to members now point at the super-node; no duplicate parallel edges.
3. **Super-node excluded from hull** — the collapsed super-node sits outside the task hulls (hulls now enclose only individual nodes).
4. **Expand from the graph** — click the super-node: the group expands (timeline header returns to `▾`, six nodes reappear). Symmetric with the timeline toggle.
5. **Scrub** — with a group collapsed, scrubbing the playhead recolors individual nodes but the super-node keeps its neutral color and NOTHING re-layouts (2C holds). Comets that target a collapsed member fly to the super-node.
6. **Causal focus** — select an individual node that has an edge to/from a collapsed member: the super-node stays bright (not ghosted) because a member is in the chain.

Report observations. If the app can't launch, report DONE_WITH_CONCERNS noting build + type-check + unit tests passed and only the live check remains.

---

## Self-Review Notes

- **Spec coverage:** `GraphNode.group?` (spec §2) → Task 1; pure `collapseGraph` merge/reroute/dedup/remap (spec §2) → Task 2; rebuild keyed on collapsedGroups + cluster-only-individual (spec §3) → Task 3 Steps 1-2; super-node render + neutral color + causal focus member rule (spec §4) → Task 3 Step 4; comet remap (spec §4) → Task 3 Step 3; click-to-expand + tooltip (spec §4) → Task 3 Step 5.
- **Placeholder scan:** none — every step has concrete code. (Task 3 Step 4 gives the corrected null-safe `inChain`/`globalAlpha` form explicitly.)
- **Type consistency:** `collapseGraph(goroutines, edges, groups, collapsedKeys): CollapsedGraph {nodes, links, remap}` defined in Task 2, consumed in Task 3. `GraphNode.group { key, name, count, memberIds }` defined Task 1, used in Task 2 (super-node creation) and Task 3 (render/click/focus). `remap: Map<number,number>` flows Task 2 → Task 3 comet remap. Super-node id is negative (`-1, -2, …`), never collides with positive goroutine ids.
- **Invariant preserved (2C):** `collapseGraph` + clusters + seeds + forces all run only inside `rebuild`, triggered by `$summary`/`$showSystem`/`$collapsedGroups` (all genuine node-set changes). `$playhead`/`$selectedId` only redraw. Empty `collapsedKeys` ⇒ nodes/links identical to `buildGraphModel`, remap empty ⇒ graph pixel-identical to today.
- **Single source:** `collapsedGroups` store drives both the timeline (Stage 1) and the graph (this stage), so collapse stays in sync across views.
