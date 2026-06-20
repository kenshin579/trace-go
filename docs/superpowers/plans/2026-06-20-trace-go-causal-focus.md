# trace-go Selection Causal Focus (analysis ①) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a goroutine node is selected, dim everything except its 1-hop causal chain (direct unblockers + unblockees) in both the graph and the timeline, so "who woke this / what it woke" is answered at a glance.

**Architecture:** A pure `causalNeighbors(edges, selectedId)` lib function returns the 1-hop chain id set (time-independent, computed from the full edge set). `GraphCanvas` and `TimelineCanvas` both consume that set in `draw()` and lower `globalAlpha` for non-chain elements. Focus is opt-in: with no selection, both views render exactly as today. No layout/simulation/playback/comet changes.

**Tech Stack:** Svelte 3 + TypeScript, Canvas 2D, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-20-causal-focus-design.md`.

---

## File Structure

- `frontend/src/lib/causalFocus.ts` (+ `.test.ts`) — **new**: `causalNeighbors`.
- `frontend/src/components/GraphCanvas.svelte` — **modify**: dim non-chain nodes/edges, emphasize chain edges, on selection.
- `frontend/src/components/TimelineCanvas.svelte` — **modify**: dim non-chain lanes on selection.

**Note:** Tasks 2 and 3 only change `draw()` rendering behind a `chain != null` guard, so a trace with nothing selected renders identically. They are independent (graph vs timeline) and manual-verified.

---

## Task 1: Pure causal-neighbors function

**Files:** Create `frontend/src/lib/causalFocus.ts`; Test `frontend/src/lib/causalFocus.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/causalFocus.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { causalNeighbors } from './causalFocus'
import type { CausalEdge } from './types'

const edges: CausalEdge[] = [
  { from: 1, to: 2, time: 10, category: 'channel' }, // 1 woke 2
  { from: 3, to: 1, time: 20, category: 'mutex' },   // 3 woke 1
  { from: 4, to: 5, time: 30, category: 'other' },   // unrelated
]

describe('causalNeighbors', () => {
  it('includes self plus direct incoming and outgoing neighbors', () => {
    const s = causalNeighbors(edges, 1)
    expect([...s].sort((a, b) => a - b)).toEqual([1, 2, 3]) // self=1, outgoing to 2, incoming from 3
  })
  it('ignores unrelated edges', () => {
    const s = causalNeighbors(edges, 1)
    expect(s.has(4)).toBe(false)
    expect(s.has(5)).toBe(false)
  })
  it('returns just the node when it has no causal edges', () => {
    expect([...causalNeighbors(edges, 9)]).toEqual([9])
  })
  it('adds the to-neighbor when selected is the from side', () => {
    expect(causalNeighbors([{ from: 7, to: 8, time: 0, category: 'channel' }], 7).has(8)).toBe(true)
  })
  it('adds the from-neighbor when selected is the to side', () => {
    expect(causalNeighbors([{ from: 7, to: 8, time: 0, category: 'channel' }], 8).has(7)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- causalFocus
```
Expected: FAIL — cannot find `./causalFocus`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/causalFocus.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- causalFocus && npm run check
```
Expected: all 5 tests PASS; 0 check errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/causalFocus.ts frontend/src/lib/causalFocus.test.ts
git commit -m "feat(frontend): pure causalNeighbors (1-hop causal chain set)"
```

---

## Task 2: Graph causal focus (manual-verified)

Dim non-chain nodes/edges and emphasize the selected node's incident edges when something is selected.

**Files:** Modify `frontend/src/components/GraphCanvas.svelte`.

- [ ] **Step 1: Import + constant + reactive chain**

(a) After the existing `import { nodeTooltip, edgeTooltip } from '../lib/tooltip'` line, add:
```svelte
  import { causalNeighbors } from '../lib/causalFocus'
```

(b) Add a constant near the top of the `<script>` (after the `let cssHeight = 360` line or alongside other module-level `let`/consts):
```svelte
  const GHOST_ALPHA = 0.15
```

(c) Add a reactive chain set. Place it next to the other reactive `$:` statements (e.g. just above the existing `$: void [$playhead, $selectedId], draw()` line):
```svelte
  $: chain = $summary && $selectedId != null ? causalNeighbors($summary.edges, $selectedId) : null
```
(d) Add `chain` to that redraw trigger — change:
```svelte
  $: void [$playhead, $selectedId], draw()
```
to:
```svelte
  $: void [$playhead, $selectedId, chain], draw()
```

- [ ] **Step 2: Dim/emphasize edges**

In `draw()`, replace the entire edges loop. The current loop is:
```svelte
    // Edges first (under nodes). Active edges take their (inferred) category color.
    for (const l of links) {
      const s = l.source as unknown as GraphNode
      const tg = l.target as unknown as GraphNode
      if (s.x == null || tg.x == null) continue
      const isActive = active.has(`${s.id}->${tg.id}`)
      ctx.strokeStyle = isActive ? categoryColor(l.category) : DIM_COLOR
      ctx.lineWidth = isActive ? 2.5 : 1
      ctx.beginPath()
      ctx.moveTo(s.x, s.y!)
      ctx.lineTo(tg.x, tg.y!)
      ctx.stroke()
    }
```
Replace it with:
```svelte
    // Edges first (under nodes). When a node is selected, focus mode emphasizes
    // the selected node's incident (chain) edges and ghosts the rest; otherwise
    // the playhead-window "active" coloring applies.
    for (const l of links) {
      const s = l.source as unknown as GraphNode
      const tg = l.target as unknown as GraphNode
      if (s.x == null || tg.x == null) continue
      if (chain) {
        const incident = s.id === $selectedId || tg.id === $selectedId
        ctx.globalAlpha = incident ? 1 : GHOST_ALPHA
        ctx.strokeStyle = incident ? categoryColor(l.category) : DIM_COLOR
        ctx.lineWidth = incident ? 2.5 : 1
      } else {
        const isActive = active.has(`${s.id}->${tg.id}`)
        ctx.globalAlpha = 1
        ctx.strokeStyle = isActive ? categoryColor(l.category) : DIM_COLOR
        ctx.lineWidth = isActive ? 2.5 : 1
      }
      ctx.beginPath()
      ctx.moveTo(s.x, s.y!)
      ctx.lineTo(tg.x, tg.y!)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
```

- [ ] **Step 3: Dim non-chain nodes**

Replace the nodes loop. The current loop is:
```svelte
    // Nodes.
    for (const n of nodes) {
      if (n.x == null) continue
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
```
Replace it with:
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
(The trailing `ctx.globalAlpha = 1` ensures the comets section that follows draws at full opacity.)

- [ ] **Step 4: Type-check, test, build**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm run check && npm test
cd /Users/user/GolandProjects/trace-go
wails build
```
Expected: 0 check errors; all unit suites pass; `wails build` succeeds. After build, revert spurious generated files: `git checkout -- frontend/dist/gitkeep frontend/wailsjs/runtime/`.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/components/GraphCanvas.svelte
git commit -m "feat(frontend): graph causal focus on selection"
```

---

## Task 3: Timeline causal focus + manual verification (manual-verified)

Dim non-chain lanes when a goroutine is selected.

**Files:** Modify `frontend/src/components/TimelineCanvas.svelte`.

- [ ] **Step 1: Import + constant + reactive chain**

(a) Add the import alongside the other `../lib/*` imports (e.g. after `import { taskColor } from '../lib/format'`):
```svelte
  import { causalNeighbors } from '../lib/causalFocus'
```
(b) Add a constant near the other constants (after `const TASK_ROW_H = 14`):
```svelte
  const GHOST_ALPHA = 0.15
```
(c) Add a reactive chain set next to the other reactive `$:` statements (e.g. just below the `$: lanes = ...` block):
```svelte
  $: chain = $summary && $selectedId != null ? causalNeighbors($summary.edges, $selectedId) : null
```
(d) Add `chain` to the redraw trigger — change:
```svelte
  $: void [$playhead, lanes, cssWidth, cssHeight, $selectedId, taskTrack, gcOverlay], draw()
```
Wait — this branch (`feature/causal-focus`) does NOT contain `gcOverlay` (the GC/STW overlay was a separate, abandoned branch). The actual current line is:
```svelte
  $: void [$playhead, lanes, cssWidth, cssHeight, $selectedId, taskTrack], draw()
```
Change it to:
```svelte
  $: void [$playhead, lanes, cssWidth, cssHeight, $selectedId, taskTrack, chain], draw()
```

- [ ] **Step 2: Add a per-lane alpha helper**

In `draw()`, just before the `// State bars.` loop, add a helper:
```svelte
    // In focus mode, lanes whose goroutine is not in the selected chain are ghosted.
    const laneAlpha = (gid: number) => (chain && !chain.has(gid) ? GHOST_ALPHA : 1)
```

- [ ] **Step 3: Apply the alpha in each per-lane loop**

Set `ctx.globalAlpha = laneAlpha(lane.goroutineId)` at the start of each lane iteration in the four per-lane loops, and reset to 1 before the selection outline.

(a) State bars loop — change:
```svelte
    // State bars.
    for (const lane of lanes) {
      for (const r of lane.rects) {
        ctx.fillStyle = r.color
        ctx.fillRect(r.x, lane.y, r.width, lane.height)
      }
    }
```
to:
```svelte
    // State bars.
    for (const lane of lanes) {
      ctx.globalAlpha = laneAlpha(lane.goroutineId)
      for (const r of lane.rects) {
        ctx.fillStyle = r.color
        ctx.fillRect(r.x, lane.y, r.width, lane.height)
      }
    }
```

(b) Region sub-rows loop — change the `for (const lane of lanes) {` header inside the region block to set alpha first:
```svelte
    for (const lane of lanes) {
      for (const reg of lane.regions) {
```
to:
```svelte
    for (const lane of lanes) {
      ctx.globalAlpha = laneAlpha(lane.goroutineId)
      for (const reg of lane.regions) {
```

(c) Log markers loop — change:
```svelte
    for (const lane of lanes) {
      for (const lg of lane.logs) {
```
to:
```svelte
    for (const lane of lanes) {
      ctx.globalAlpha = laneAlpha(lane.goroutineId)
      for (const lg of lane.logs) {
```

(d) Lane labels loop — change:
```svelte
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillStyle = '#cdd3df'
    for (const lane of lanes) {
      ctx.fillText(fitLabel(ctx, lane.label, GUTTER_W - 10), 4, lane.y + lane.height / 2)
    }
```
to:
```svelte
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillStyle = '#cdd3df'
    for (const lane of lanes) {
      ctx.globalAlpha = laneAlpha(lane.goroutineId)
      ctx.fillText(fitLabel(ctx, lane.label, GUTTER_W - 10), 4, lane.y + lane.height / 2)
    }
    ctx.globalAlpha = 1
```
(The reset to 1 after the label loop guarantees the selection outline and playhead draw at full opacity.)

- [ ] **Step 4: Type-check, test, build**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm run check && npm test
cd /Users/user/GolandProjects/trace-go
wails build
```
Expected: 0 check errors; all unit suites pass; `wails build` succeeds. Revert spurious generated files: `git checkout -- frontend/dist/gitkeep frontend/wailsjs/runtime/`.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/components/TimelineCanvas.svelte
git commit -m "feat(frontend): timeline causal focus on selection"
```

- [ ] **Step 6: Manual visual verification (human)**

Open a trace with causal edges (e.g. `~/Desktop/trace-tasks.out`, or generate one). Run the app (`open build/bin/trace-go.app`), open the trace, then:
1. **Click a goroutine node** in the graph → that node keeps its ring, its **direct unblockers + unblockees stay bright with emphasized (colored) edges**, and **everything else (nodes, edges) ghosts to ~15% opacity**.
2. **Timeline mirrors it** → the chain's lanes stay bright; **non-chain lanes (bars/regions/logs/labels) ghost**; the selected lane keeps its white outline; the TASKS track and playhead stay at full opacity.
3. **Scrub the playhead** → chain membership does NOT change (static); only the chain nodes' state colors update. No re-layout.
4. **Click the selected node again** (deselect) → focus clears; both views return to the normal time-based view exactly as before.
5. **Comets/playback** still work during focus (edges flash on forward scrub).

Report observations. If the app can't launch, report DONE_WITH_CONCERNS noting build + type-check + unit tests passed and only the live check remains.

---

## Self-Review Notes

- **Spec coverage:** pure `causalNeighbors` (spec §2) → Task 1; graph dim + chain-edge emphasis (spec §3) → Task 2; timeline non-chain lane dim (spec §4) → Task 3; testing (spec §5) → Tasks 1–3.
- **Placeholder scan:** none — every step shows concrete code.
- **Type consistency:** `causalNeighbors(edges, selectedId): Set<number>` is defined in Task 1 and called identically in Tasks 2 & 3; `chain` is `Set<number> | null` in both components; `GHOST_ALPHA = 0.15` is the dim level in both; `lane.goroutineId` is the lane's id field (matches existing selection-outline code `lane.goroutineId === $selectedId`).
- **Invariant preserved:** all focus rendering is guarded by `chain` being non-null (i.e. something selected); `$selectedId === null` → `chain === null` → identical-to-today rendering. `globalAlpha` is reset to 1 after each dimmed region (before comets / selection outline / playhead). No simulation/layout/playback changes.
- **Branch note:** Task 3 Step 1(d) explicitly accounts for this branch NOT having the abandoned GC-overlay's `gcOverlay` in the redraw tuple — the implementer must match the actual current line.
