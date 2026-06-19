# trace-go Plan 2E — Edge Flash + Timeline Lane Labels

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a category-colored "comet + arrival ring" flash that plays on the graph whenever the playhead crosses a causal edge's fire time, and show goroutine names in a left gutter on the timeline.

**Architecture:** New view logic is pure and unit-tested (`lib/flash.ts` crossing-detection + comet lerp; `categoryColor` in `lib/format.ts`; an optional `gutter` offset in `lib/timelineLayout.ts`). `GraphCanvas` gains a *second* `requestAnimationFrame` loop — separate from the force simulation and the store's playback loop — that lives only while comets are in flight and never moves node positions (so the "graph doesn't re-jitter on time change" invariant holds). `TimelineCanvas` reserves a fixed gutter and draws truncated lane labels. No Go, store, or data-model changes.

**Tech Stack:** Svelte 3 + TypeScript + Vite, Vitest, HTML Canvas 2D (existing). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-20-edge-flash-lane-labels-design.md`. Scope = C7 (edge flash) + C9 (lane labels); C8 (zoom/pan) is a separate future plan. Plans 1, 2A–2D are merged on `main`; 54 vitest tests pass.

**Honesty:** comets/colors mean an *inferred* synchronization category (channel/mutex/other), not a literal value — the edge hover tooltip and legend keep the word "inferred".

---

## File Structure

- `frontend/src/lib/format.ts` — **modify**: add `CATEGORY_COLORS` + `categoryColor(category)`.
- `frontend/src/lib/flash.ts` — **new**: `edgesCrossed`, `cometPoint`, `FLASH_MS`, `MAX_PARTICLES`. Test: `flash.test.ts`.
- `frontend/src/lib/timelineLayout.ts` — **modify**: optional `gutter` in `LayoutOptions` (default 0). Test: extend `timelineLayout.test.ts`.
- `frontend/src/components/GraphCanvas.svelte` — **modify**: comet/ring flash + category-colored active edges + second rAF loop.
- `frontend/src/components/TimelineCanvas.svelte` — **modify**: left gutter with truncated lane labels; offset scale/scrub/hit.
- `frontend/src/components/Legend.svelte` — **modify**: per-category edge entries.

---

## Task 1: `categoryColor` in format.ts

**Files:** Modify `frontend/src/lib/format.ts`; Test: `frontend/src/lib/format.test.ts`.

- [ ] **Step 1: Write the failing test (append to existing file)**

Append to `frontend/src/lib/format.test.ts`:
```ts
import { categoryColor } from './format'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- format
```
Expected: FAIL — `categoryColor` is not exported.

- [ ] **Step 3: Write the implementation (append to format.ts)**

Append to `frontend/src/lib/format.ts`:
```ts
import type { EdgeCategory } from './types'

// Per-category edge/comet colors. These encode the inferred synchronization
// kind, NOT a transferred value (the trace has no channel identity).
export const CATEGORY_COLORS: Record<EdgeCategory, string> = {
  channel: '#5b8def',
  mutex: '#e0a030',
  other: '#a78bdb',
}

export function categoryColor(category: EdgeCategory): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.channel
}
```
(The `import type` is erased at compile time, so the type-only cycle with `types.ts` is harmless.)

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- format
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/format.ts frontend/src/lib/format.test.ts
git commit -m "feat(frontend): add per-category edge colors"
```

---

## Task 2: `lib/flash.ts` — crossing detection + comet lerp

**Files:** Create `frontend/src/lib/flash.ts`; Test: `frontend/src/lib/flash.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/flash.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { edgesCrossed, cometPoint, FLASH_MS, MAX_PARTICLES } from './flash'
import type { CausalEdge } from './types'

const edges: CausalEdge[] = [
  { from: 1, to: 2, time: 10, category: 'channel' },
  { from: 2, to: 3, time: 20, category: 'mutex' },
  { from: 3, to: 1, time: 30, category: 'other' },
]

describe('edgesCrossed', () => {
  it('returns edges with prevT < time <= nowT (forward)', () => {
    expect(edgesCrossed(edges, 5, 20).map((e) => e.time)).toEqual([10, 20])
  })
  it('is start-exclusive, end-inclusive', () => {
    expect(edgesCrossed(edges, 10, 20).map((e) => e.time)).toEqual([20]) // 10 excluded, 20 included
  })
  it('returns nothing when not moving forward', () => {
    expect(edgesCrossed(edges, 20, 20)).toEqual([])
    expect(edgesCrossed(edges, 30, 5)).toEqual([])
  })
})

describe('cometPoint', () => {
  it('lerps along the segment by progress', () => {
    expect(cometPoint(0, 0, 0, 100, 50)).toEqual({ x: 0, y: 0 })
    expect(cometPoint(1, 0, 0, 100, 50)).toEqual({ x: 100, y: 50 })
    expect(cometPoint(0.5, 0, 0, 100, 50)).toEqual({ x: 50, y: 25 })
  })
  it('clamps progress to [0,1]', () => {
    expect(cometPoint(-1, 0, 0, 100, 0)).toEqual({ x: 0, y: 0 })
    expect(cometPoint(2, 0, 0, 100, 0)).toEqual({ x: 100, y: 0 })
  })
})

describe('constants', () => {
  it('are sane', () => {
    expect(FLASH_MS).toBeGreaterThan(0)
    expect(MAX_PARTICLES).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- flash
```
Expected: FAIL — cannot find `./flash`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/flash.ts`:
```ts
import type { CausalEdge } from './types'

// A comet animates over this many real (wall-clock) milliseconds, independent
// of playback speed.
export const FLASH_MS = 600

// Cap on concurrently animating comets (guards against a fast scrub spawning a
// storm of them in one step).
export const MAX_PARTICLES = 60

// edgesCrossed returns the edges whose fire time was passed moving the playhead
// FORWARD from prevT to nowT: prevT < time <= nowT. Empty if not advancing.
export function edgesCrossed(edges: CausalEdge[], prevT: number, nowT: number): CausalEdge[] {
  if (nowT <= prevT) return []
  return edges.filter((e) => e.time > prevT && e.time <= nowT)
}

// cometPoint linearly interpolates a point along segment a→b by progress (0..1).
export function cometPoint(
  progress: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number } {
  const p = Math.max(0, Math.min(1, progress))
  return { x: ax + (bx - ax) * p, y: ay + (by - ay) * p }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- flash
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/flash.ts frontend/src/lib/flash.test.ts
git commit -m "feat(frontend): add edge-crossing detection and comet lerp"
```

---

## Task 3: `gutter` option in timelineLayout

**Files:** Modify `frontend/src/lib/timelineLayout.ts`; Test: extend `frontend/src/lib/timelineLayout.test.ts`.

- [ ] **Step 1: Write the failing test (append to existing file)**

Append to `frontend/src/lib/timelineLayout.test.ts`:
```ts
describe('layoutTimeline gutter', () => {
  const summary = {
    startTime: 0,
    endTime: 100,
    goroutines: [
      { id: 1, name: 'a', createdAt: 0, endedAt: 100, intervals: [{ start: 0, end: 50, state: 'running', blockReason: '' }] },
    ],
    edges: [],
  } as any

  it('offsets the time axis to start at the gutter', () => {
    const lanes = layoutTimeline(summary, { width: 200, laneHeight: 20, laneGap: 4, gutter: 50 })
    // t=0 maps to x=gutter; t=50 (half of span 100) maps to gutter + half of (200-50)=125.
    expect(lanes[0].rects[0].x).toBe(50)
    expect(lanes[0].rects[0].width).toBeCloseTo(75)
  })

  it('defaults to no gutter when omitted', () => {
    const lanes = layoutTimeline(summary, { width: 200, laneHeight: 20, laneGap: 4 })
    expect(lanes[0].rects[0].x).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- timelineLayout
```
Expected: FAIL — gutter not applied (first assertion expects x=50, gets 0).

- [ ] **Step 3: Implement**

In `frontend/src/lib/timelineLayout.ts`, add `gutter` to the options interface:
```ts
export interface LayoutOptions {
  width: number // pixel width of the time axis
  laneHeight: number
  laneGap: number
  gutter?: number // left offset reserved for lane labels; time axis starts here
}
```
and change the scale construction in `layoutTimeline` from:
```ts
  const scale = makeTimeScale(summary.startTime, summary.endTime, 0, opts.width)
```
to:
```ts
  const scale = makeTimeScale(summary.startTime, summary.endTime, opts.gutter ?? 0, opts.width)
```
(Everything else in `layoutTimeline` is unchanged — `rect.x` now includes the gutter offset.)

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- timelineLayout
```
Expected: all timelineLayout tests PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/timelineLayout.ts frontend/src/lib/timelineLayout.test.ts
git commit -m "feat(frontend): add optional gutter offset to timeline layout"
```

---

## Task 4: GraphCanvas edge flash (manual-verified)

Adds the comet+ring animation. Replaces `GraphCanvas.svelte` with the version below — the changes are: imports (`flash`, `categoryColor`), `nodeById`/`comets`/`prevT`/`animId` state, a `onPlayheadChange` reactive that spawns comets on forward crossings, a second rAF loop (`animTick`), comet/ring drawing in `draw()`, and category-colored active edges. The simulation, hover tooltip, click-select, and resize logic are unchanged.

**Files:** Modify `frontend/src/components/GraphCanvas.svelte`.

- [ ] **Step 1: Replace the component with the flash-enabled version**

Write `frontend/src/components/GraphCanvas.svelte`:
```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import {
    forceSimulation,
    forceManyBody,
    forceLink,
    forceCenter,
    forceCollide,
    type Simulation,
  } from 'd3-force'
  import { traceStore } from '../stores/trace'
  import { visibleGoroutines } from '../lib/filter'
  import { buildGraphModel, type GraphNode, type GraphLink } from '../lib/graphModel'
  import { stateAt, activeEdges } from '../lib/activeAt'
  import { stateColor, DIM_COLOR, categoryColor, goroutineLabel } from '../lib/format'
  import { edgesCrossed, cometPoint, FLASH_MS, MAX_PARTICLES } from '../lib/flash'
  import type { Goroutine, CausalEdge } from '../lib/types'
  import { nodeAtPoint, distToSegment } from '../lib/hit'
  import { nodeTooltip, edgeTooltip } from '../lib/tooltip'

  const { summary, playhead, showSystem, selectedId } = traceStore

  let container: HTMLDivElement
  let canvas: HTMLCanvasElement
  let cssWidth = 600
  let cssHeight = 360

  let nodes: GraphNode[] = []
  let links: GraphLink[] = []
  let goroutineById = new Map<number, Goroutine>()
  let nodeById = new Map<number, GraphNode>()
  let sim: Simulation<GraphNode, GraphLink> | undefined
  let tip: { text: string; x: number; y: number } | null = null

  // Flash state: comets in flight + last playhead for crossing detection.
  type Comet = { from: GraphNode; to: GraphNode; color: string; start: number }
  let comets: Comet[] = []
  let prevT: number | null = null
  let animId = 0

  // Rebuild the graph + simulation ONLY when the visible node set changes
  // (summary or filter) — never on playhead, so the layout stays stable.
  $: rebuild($summary ? visibleGoroutines($summary, $showSystem) : [], $summary?.edges ?? [])

  function rebuild(goroutines: Goroutine[], edges: CausalEdge[]) {
    goroutineById = new Map(goroutines.map((g) => [g.id, g]))
    const model = buildGraphModel(goroutines, edges)
    nodes = model.nodes
    links = model.links
    nodeById = new Map(nodes.map((n) => [n.id, n]))
    comets = []
    prevT = null // re-arm crossing detection for the new node set
    sim?.stop()
    if (nodes.length === 0) {
      draw()
      return
    }
    sim = forceSimulation<GraphNode>(nodes)
      .force('charge', forceManyBody().strength(-120))
      .force('link', forceLink<GraphNode, GraphLink>(links).id((d) => d.id).distance(60))
      .force('center', forceCenter(cssWidth / 2, cssHeight / 2))
      .force('collide', forceCollide(16))
      .on('tick', draw)
  }

  // Spawn comets when the playhead moves FORWARD across edge fire times.
  $: onPlayheadChange($playhead)

  function onPlayheadChange(t: number) {
    if (prevT === null) {
      prevT = t
      return
    }
    if (t > prevT && $summary) {
      for (const e of edgesCrossed($summary.edges, prevT, t)) {
        if (comets.length >= MAX_PARTICLES) break
        const a = nodeById.get(e.from)
        const b = nodeById.get(e.to)
        if (!a || !b) continue
        comets.push({ from: a, to: b, color: categoryColor(e.category), start: performance.now() })
      }
      if (comets.length) ensureAnim()
    }
    prevT = t
  }

  function ensureAnim() {
    if (!animId && typeof requestAnimationFrame !== 'undefined') {
      animId = requestAnimationFrame(animTick)
    }
  }
  function animTick(now: number) {
    comets = comets.filter((c) => now - c.start < FLASH_MS)
    draw()
    if (comets.length && typeof requestAnimationFrame !== 'undefined') {
      animId = requestAnimationFrame(animTick)
    } else {
      animId = 0
    }
  }

  // Redraw (recolor + comets) on time/selection change. Does NOT touch the sim.
  $: void [$playhead, $selectedId], draw()

  function draw() {
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(cssHeight * dpr)
    canvas.style.height = cssHeight + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#0f1117'
    ctx.fillRect(0, 0, cssWidth, cssHeight)

    const t = $playhead
    const span = $summary ? $summary.endTime - $summary.startTime : 0
    const win = span * 0.03
    const active = $summary ? new Set(activeEdges($summary.edges, t, win).map((e) => `${e.from}->${e.to}`)) : new Set<string>()
    const catByPair = new Map<string, string>()
    if ($summary) for (const e of $summary.edges) catByPair.set(`${e.from}->${e.to}`, e.category)

    // Edges first (under nodes). Active edges take their category color.
    for (const l of links) {
      const s = l.source as unknown as GraphNode
      const tg = l.target as unknown as GraphNode
      if (s.x == null || tg.x == null) continue
      const key = `${s.id}->${tg.id}`
      const isActive = active.has(key)
      ctx.strokeStyle = isActive ? categoryColor((catByPair.get(key) as any) ?? l.category) : DIM_COLOR
      ctx.lineWidth = isActive ? 2.5 : 1
      ctx.beginPath()
      ctx.moveTo(s.x, s.y!)
      ctx.lineTo(tg.x, tg.y!)
      ctx.stroke()
    }

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

    // Comets + arrival rings (on top).
    const nowMs = typeof performance !== 'undefined' ? performance.now() : 0
    for (const c of comets) {
      if (c.from.x == null || c.to.x == null) continue
      const p = Math.min(1, (nowMs - c.start) / FLASH_MS)
      // Trailing dots behind the lead for a comet look.
      const lead = [
        { off: 0, r: 5, a: 1 },
        { off: -0.06, r: 3.5, a: 0.5 },
        { off: -0.12, r: 2.5, a: 0.25 },
      ]
      for (const d of lead) {
        const pp = p + d.off
        if (pp < 0) continue
        const pt = cometPoint(pp, c.from.x, c.from.y!, c.to.x, c.to.y!)
        ctx.globalAlpha = d.a
        ctx.fillStyle = c.color
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      // Arrival ring in the last 30% of travel.
      if (p > 0.7) {
        const rp = (p - 0.7) / 0.3
        ctx.globalAlpha = 1 - rp
        ctx.strokeStyle = c.color
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(c.to.x, c.to.y!, 9 + rp * 16, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }
  }

  function labelOf(id: number): string {
    const g = goroutineById.get(id)
    return g ? goroutineLabel(g) : `g${id}`
  }
  function onClick(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect()
    const n = nodeAtPoint(nodes, e.clientX - rect.left, e.clientY - rect.top, 10)
    if (n) traceStore.toggleSelected(n.id)
  }
  function onPointerMove(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const n = nodeAtPoint(nodes, px, py, 10)
    if (n) {
      const g = goroutineById.get(n.id)
      tip = { text: nodeTooltip(n.label, g ? stateAt(g, $playhead) : null), x: px, y: py }
      return
    }
    let best: { l: GraphLink; d: number } | null = null
    for (const l of links) {
      const s = l.source as unknown as GraphNode
      const t = l.target as unknown as GraphNode
      if (s.x == null || t.x == null) continue
      const d = distToSegment(px, py, s.x, s.y!, t.x, t.y!)
      if (d <= 5 && (!best || d < best.d)) best = { l, d }
    }
    if (best) {
      const s = best.l.source as unknown as GraphNode
      const t = best.l.target as unknown as GraphNode
      tip = { text: edgeTooltip(best.l.category, labelOf(s.id), labelOf(t.id)), x: px, y: py }
    } else {
      tip = null
    }
  }
  function onPointerLeave() {
    tip = null
  }

  onMount(() => {
    const measure = () => {
      cssWidth = container.clientWidth || cssWidth
      cssHeight = container.clientHeight || cssHeight
      sim?.force('center', forceCenter(cssWidth / 2, cssHeight / 2))
      sim?.alpha(0.3).restart()
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    draw()
    return () => ro.disconnect()
  })
  onDestroy(() => {
    sim?.stop()
    if (animId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animId)
  })
</script>

<div bind:this={container} class="graph-wrap" on:pointerleave={onPointerLeave}>
  <canvas
    bind:this={canvas}
    on:click={onClick}
    on:pointermove={onPointerMove}
    style="width:100%; display:block; cursor:pointer;"
  ></canvas>
  {#if tip}
    <div class="tip" style="left:{tip.x + 12}px; top:{tip.y + 12}px">{tip.text}</div>
  {/if}
</div>

<style>
  .graph-wrap { width: 100%; height: 100%; min-height: 280px; position: relative; }
  .tip {
    position: absolute; pointer-events: none; white-space: pre; z-index: 10;
    background: #161922; color: #cdd3df; border: 1px solid #2a2e38;
    border-radius: 4px; padding: 4px 8px; font-size: 12px; line-height: 1.35;
  }
</style>
```

- [ ] **Step 2: Type-check and run the unit suite**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm run check && npm test
```
Expected: 0 check errors; all unit suites still pass (component has no unit tests; this confirms it compiles and nothing else broke).

- [ ] **Step 3: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/components/GraphCanvas.svelte
git commit -m "feat(frontend): edge flash comets with arrival ring on the graph"
```

---

## Task 5: TimelineCanvas lane labels (manual-verified)

Adds a left gutter with truncated goroutine labels and offsets the time axis. Replaces `TimelineCanvas.svelte` with the version below — changes: `GUTTER_W` const, `gutter` passed to `layoutTimeline`, `makeTimeScale` range starts at `GUTTER_W` (in both `draw` and `timeAtClientX`), a `fitLabel` truncation helper, and label drawing in `draw()`. Scrub/hover/selection logic is otherwise unchanged.

**Files:** Modify `frontend/src/components/TimelineCanvas.svelte`.

- [ ] **Step 1: Replace the component**

Write `frontend/src/components/TimelineCanvas.svelte`:
```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import { traceStore } from '../stores/trace'
  import { layoutTimeline, type Lane } from '../lib/timelineLayout'
  import { makeTimeScale } from '../lib/timeMap'
  import { visibleGoroutines } from '../lib/filter'
  import { hitTimeline } from '../lib/hit'
  import { intervalTooltip } from '../lib/tooltip'

  const { summary, playhead, showSystem, selectedId, setPlayhead } = traceStore

  let container: HTMLDivElement
  let canvas: HTMLCanvasElement
  let cssWidth = 800
  const LANE_H = 18
  const LANE_GAP = 3
  const GUTTER_W = 120 // left column reserved for goroutine labels

  let dragging = false
  let tip: { text: string; x: number; y: number } | null = null

  $: visible = $summary ? visibleGoroutines($summary, $showSystem) : []
  $: lanes = $summary
    ? layoutTimeline(
        { ...$summary, goroutines: visible },
        { width: cssWidth, laneHeight: LANE_H, laneGap: LANE_GAP, gutter: GUTTER_W },
      )
    : ([] as Lane[])
  $: cssHeight = Math.max(400, visible.length * (LANE_H + LANE_GAP))

  $: void [$playhead, lanes, cssWidth, cssHeight, $selectedId], draw()

  // Truncate a label with an ellipsis so it fits in maxW pixels.
  function fitLabel(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
    if (ctx.measureText(text).width <= maxW) return text
    let s = text
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1)
    return s + '…'
  }

  function draw() {
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(cssHeight * dpr)
    canvas.style.height = cssHeight + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.fillStyle = '#0f1117'
    ctx.fillRect(0, 0, cssWidth, cssHeight)

    for (const lane of lanes) {
      for (const r of lane.rects) {
        ctx.fillStyle = r.color
        ctx.fillRect(r.x, lane.y, r.width, lane.height)
      }
    }

    // Lane labels in the left gutter.
    ctx.font = '11px system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#cdd3df'
    for (const lane of lanes) {
      ctx.fillText(fitLabel(ctx, lane.label, GUTTER_W - 10), 4, lane.y + lane.height / 2)
    }

    const lanesBottom = lanes.length * (LANE_H + LANE_GAP)

    for (const lane of lanes) {
      if (lane.goroutineId === $selectedId) {
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.strokeRect(GUTTER_W + 0.5, lane.y + 0.5, cssWidth - GUTTER_W - 1, lane.height - 1)
      }
    }

    if ($summary) {
      const scale = makeTimeScale($summary.startTime, $summary.endTime, GUTTER_W, cssWidth)
      const x = scale.toPixel($playhead)
      ctx.strokeStyle = '#5b8def'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, Math.max(lanesBottom, 1))
      ctx.stroke()
    }
  }

  function timeAtClientX(clientX: number): number {
    if (!$summary) return 0
    const rect = canvas.getBoundingClientRect()
    const scale = makeTimeScale($summary.startTime, $summary.endTime, GUTTER_W, cssWidth)
    return scale.toTime(clientX - rect.left) // store clamps to [startTime,endTime]
  }

  function onPointerDown(e: PointerEvent) {
    dragging = true
    setPlayhead(timeAtClientX(e.clientX))
  }
  function onPointerMove(e: PointerEvent) {
    if (dragging) {
      setPlayhead(timeAtClientX(e.clientX))
      tip = null
      return
    }
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const h = hitTimeline(lanes, x, y, LANE_H + LANE_GAP, LANE_H)
    if (h && h.rect) {
      tip = { text: intervalTooltip(h.lane.label, h.rect.state, h.rect.blockReason), x, y }
    } else {
      tip = null
    }
  }
  function onPointerLeave() {
    tip = null
  }
  function onPointerUp() {
    dragging = false
  }

  onMount(() => {
    const measure = () => {
      cssWidth = container.clientWidth || cssWidth
    }
    measure()
    draw()
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      ro.disconnect()
      window.removeEventListener('pointerup', onPointerUp)
    }
  })
</script>

<div bind:this={container} class="timeline-canvas-wrap" on:pointerleave={onPointerLeave}>
  <canvas
    bind:this={canvas}
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    style="width:100%; cursor: ew-resize; display:block;"
  ></canvas>
  {#if tip}
    <div class="tip" style="left:{tip.x + 12}px; top:{tip.y + 12}px">{tip.text}</div>
  {/if}
</div>

<style>
  .timeline-canvas-wrap { width: 100%; position: relative; }
  .tip {
    position: absolute; pointer-events: none; white-space: pre; z-index: 10;
    background: #161922; color: #cdd3df; border: 1px solid #2a2e38;
    border-radius: 4px; padding: 4px 8px; font-size: 12px; line-height: 1.35;
  }
</style>
```

- [ ] **Step 2: Type-check and run the unit suite**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm run check && npm test
```
Expected: 0 check errors; all unit suites still pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/components/TimelineCanvas.svelte
git commit -m "feat(frontend): timeline lane labels in a left gutter"
```

---

## Task 6: Legend update + build + visual verification

**Files:** Modify `frontend/src/components/Legend.svelte`.

- [ ] **Step 1: Replace the Legend with per-category edge entries**

Write `frontend/src/components/Legend.svelte`:
```svelte
<script lang="ts">
  import { stateColor, DIM_COLOR, categoryColor } from '../lib/format'

  const states: { label: string; color: string }[] = [
    { label: 'running', color: stateColor('running') },
    { label: 'runnable', color: stateColor('runnable') },
    { label: 'blocked', color: stateColor('blocked') },
    { label: 'not alive', color: DIM_COLOR },
  ]
  const edges: { label: string; color: string }[] = [
    { label: 'channel', color: categoryColor('channel') },
    { label: 'mutex', color: categoryColor('mutex') },
    { label: 'other', color: categoryColor('other') },
  ]
</script>

<div class="legend">
  {#each states as s}
    <span class="item"><span class="swatch" style="background:{s.color}"></span>{s.label}</span>
  {/each}
  {#each edges as e}
    <span class="item"><span class="edge" style="border-top-color:{e.color}"></span>{e.label} (inferred)</span>
  {/each}
  <span class="item"><span class="edge" style="border-top-color:{DIM_COLOR}"></span>inferred link</span>
</div>

<style>
  .legend { display: flex; flex-wrap: wrap; gap: 14px; padding: 6px 14px; border-top: 1px solid #2a2e38; font-size: 12px; color: #8a93a3; }
  .item { display: flex; align-items: center; gap: 6px; }
  .swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
  .edge { width: 16px; height: 0; border-top: 2px solid; display: inline-block; }
</style>
```

- [ ] **Step 2: Type-check, unit tests, and production build**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm run check && npm test
cd /Users/user/GolandProjects/trace-go
wails build
```
Expected: 0 check errors; all unit suites pass; `wails build` succeeds (the automated gate that the new components compile in the production bundle).

- [ ] **Step 3: Manual visual verification (human)**

Open the built app (or `wails dev`), open a trace (e.g. `~/Desktop/trace.out`), and confirm:
1. Pressing ▶ (or scrubbing forward) makes category-colored comets travel along graph edges from the unblocker to the unblocked node, with an arrival ring; **the graph layout does NOT re-jitter** as time moves.
2. Scrubbing backward fires no comets; scrubbing forward again re-fires them.
3. Comet/active-edge colors match the legend (channel blue, mutex amber, other purple); the legend shows the three categories + "inferred link".
4. The timeline shows goroutine names in the left gutter (long names truncated with "…"), and the playhead/scrub line up correctly to the right of the gutter.

Report observations. If `wails dev` can't launch, report DONE_WITH_CONCERNS noting build + type-check + unit tests passed and only the live check remains.

- [ ] **Step 4: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/components/Legend.svelte
git commit -m "feat(frontend): per-category edge legend"
```

---

## Self-Review Notes

- **Spec coverage:** C7 flash behavior (forward-crossing trigger, comet+ring, category color, MAX_PARTICLES cap, separate rAF loop, sim untouched) → Tasks 2, 4. Category colors + active-edge recolor + legend → Tasks 1, 4, 6. C9 lane labels (gutter offset, truncation, scrub/hit/playhead alignment) → Tasks 3, 5. Honesty "(inferred)" preserved in tooltip (unchanged) + legend (Task 6).
- **Deferred (separate plan):** C8 zoom/pan.
- **Type consistency:** `categoryColor`/`CATEGORY_COLORS` (format.ts), `edgesCrossed`/`cometPoint`/`FLASH_MS`/`MAX_PARTICLES` (flash.ts), `LayoutOptions.gutter` (timelineLayout.ts), and `GUTTER_W` (TimelineCanvas) are used consistently. The comet detection reads raw `$summary.edges` (with `time`), not the deduped `links`; node positions come from `nodeById`.
- **Invariant preserved:** the flash uses a second rAF that only redraws (never mutates node positions or restarts the sim), so "graph doesn't re-jitter on time change" still holds. `prevT` resets to `null` on rebuild so a filter/summary change can't spawn a spurious crossing burst.
- **No store/Go changes:** `GraphCanvas` tracks its own `prevT` locally; `timelineLayout.gutter` defaults to 0 so existing tests/behavior are preserved.
- **Manual-verification honesty:** only Task 6 Step 3 needs a running GUI; build is the automated compile gate and all pure logic is unit-tested.
