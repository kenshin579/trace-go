# trace-go Timeline Goroutine Grouping (B6 Stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group goroutines that share a start function into a foldable header row in the timeline (default expanded), so long worker-pool lane lists can be collapsed to one line; keep the collapse state in the store so a later graph stage can reuse it.

**Architecture:** A pure `groupGoroutines` builds ordered groups by start-function name (≥2 members = a real group). The timeline layout evolves from `Lane[]` to a `TimelineRow[]` union (header rows + lane rows) via a new `layoutTimelineRows`, sharing a `buildLane` helper with the old function during migration. The store gains `collapsedGroups`/`toggleGroup`. `TimelineCanvas` renders header rows with a disclosure triangle and toggles collapse on header click. Graph, playback, selection, causal-focus, and TASKS track are untouched.

**Tech Stack:** Svelte 3 + TypeScript, Canvas 2D, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-21-timeline-grouping-design.md`.

---

## File Structure

- `frontend/src/lib/grouping.ts` (+ `.test.ts`) — **new**: `groupGoroutines`, `GoroutineGroup`.
- `frontend/src/lib/timelineLayout.ts` (+ `.test.ts`) — **modify**: extract `buildLane`; add `TimelineRow`, `GROUP_HEADER_H`, `layoutTimelineRows`, `hitGroupHeader`.
- `frontend/src/stores/trace.ts` (+ `.test.ts`) — **modify**: `collapsedGroups`, `toggleGroup`, reset on `loadSummary`.
- `frontend/src/components/TimelineCanvas.svelte` — **modify**: render via rows, draw headers, header-click toggle; drop the now-unused `layoutTimeline`.

**Migration note:** Task 3 keeps the old `layoutTimeline` working (it delegates to the shared `buildLane`) so the build/tests stay green mid-plan. Task 4 migrates the component to `layoutTimelineRows` and removes the now-unused `layoutTimeline` plus its old test blocks (the layout math is re-covered by Task 3's `layoutTimelineRows` tests).

---

## Task 1: Pure goroutine grouping

**Files:** Create `frontend/src/lib/grouping.ts`; Test `frontend/src/lib/grouping.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/grouping.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { groupGoroutines } from './grouping'
import type { Goroutine } from './types'

function g(id: number, name: string): Goroutine {
  return { id, name, createdAt: 0, endedAt: 0, intervals: [] }
}

describe('groupGoroutines', () => {
  it('groups goroutines that share a non-empty start function (>=2)', () => {
    const groups = groupGoroutines([g(1, 'main.worker'), g(2, 'main.worker'), g(3, 'main.worker')])
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('main.worker')
    expect(groups[0].name).toBe('main.worker')
    expect(groups[0].members.map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('keeps a unique-named goroutine as a solo group (1 member)', () => {
    const groups = groupGoroutines([g(1, 'main.a'), g(2, 'main.b')])
    expect(groups).toHaveLength(2)
    expect(groups.every((gr) => gr.members.length === 1)).toBe(true)
  })

  it('mixes a shared group and solo goroutines, preserving first-appearance order', () => {
    const groups = groupGoroutines([g(1, 'main.solo'), g(2, 'main.w'), g(3, 'main.w')])
    expect(groups.map((gr) => gr.key)).toEqual(['main.solo', 'main.w'])
    expect(groups[1].members.map((m) => m.id)).toEqual([2, 3])
  })

  it('never groups empty-name goroutines together (each is solo with a unique key)', () => {
    const groups = groupGoroutines([g(1, ''), g(2, '')])
    expect(groups).toHaveLength(2)
    expect(groups[0].members).toHaveLength(1)
    expect(groups[1].members).toHaveLength(1)
    expect(groups[0].key).not.toBe(groups[1].key)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- grouping
```
Expected: FAIL — cannot find `./grouping`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/grouping.ts`:
```ts
import type { Goroutine } from './types'

export interface GoroutineGroup {
  key: string // group identifier = shared start-function name; empty-name goroutines get a unique solo key
  name: string // display name
  members: Goroutine[] // 1 = solo (no header); 2+ = a real group (header)
}

// groupGoroutines buckets goroutines that share a non-empty start function (name)
// into one group, preserving first-appearance order; their members keep input
// order. A goroutine with an empty name, or a name shared by no one else, becomes
// a solo group (members.length === 1). Empty-name goroutines never merge: each
// gets a unique key so they stay separate solo rows.
export function groupGoroutines(goroutines: Goroutine[]): GoroutineGroup[] {
  const order: string[] = []
  const byKey = new Map<string, GoroutineGroup>()
  for (const g of goroutines) {
    // Empty-name goroutines must not merge: give each a unique key.
    const key = g.name === '' ? `g${g.id}` : g.name
    let group = byKey.get(key)
    if (!group) {
      group = { key, name: g.name, members: [] }
      byKey.set(key, group)
      order.push(key)
    }
    group.members.push(g)
  }
  return order.map((k) => byKey.get(k)!)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- grouping && npm run check
```
Expected: all 4 tests PASS; 0 check errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/grouping.ts frontend/src/lib/grouping.test.ts
git commit -m "feat(frontend): pure groupGoroutines (group by start function)"
```

---

## Task 2: Store collapse state

**Files:** Modify `frontend/src/stores/trace.ts`; Test `frontend/src/stores/trace.test.ts`.

- [ ] **Step 1: Write the failing test (append to trace.test.ts)**

Add this block (the file already imports `createTraceStore` and uses `get` from `svelte/store` — reuse the existing imports; if `get` is not imported in this file, add `import { get } from 'svelte/store'`):
```ts
describe('collapsedGroups', () => {
  it('toggles a group key on and off', () => {
    const store = createTraceStore()
    expect(get(store.collapsedGroups).has('main.w')).toBe(false)
    store.toggleGroup('main.w')
    expect(get(store.collapsedGroups).has('main.w')).toBe(true)
    store.toggleGroup('main.w')
    expect(get(store.collapsedGroups).has('main.w')).toBe(false)
  })

  it('resets collapsed groups when a new trace loads', () => {
    const store = createTraceStore()
    store.toggleGroup('main.w')
    expect(get(store.collapsedGroups).size).toBe(1)
    store.loadSummary({ startTime: 0, endTime: 10, goroutines: [], edges: [] })
    expect(get(store.collapsedGroups).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- "stores/trace"
```
Expected: FAIL — `collapsedGroups` / `toggleGroup` do not exist.

- [ ] **Step 3: Implement**

In `frontend/src/stores/trace.ts`:

(a) Add to the `TraceStore` interface (after `selectedId: Writable<number | null>`):
```ts
  collapsedGroups: Writable<Set<string>>
```
and add to the methods list (after `toggleSelected(id: number): void`):
```ts
  toggleGroup(key: string): void
```

(b) Create the writable next to the others (after `const selectedId = writable<number | null>(null)`):
```ts
  const collapsedGroups = writable<Set<string>>(new Set())
```

(c) Expose it in the `api` object (after `selectedId,`):
```ts
    collapsedGroups,
```

(d) Reset it in `loadSummary` (inside the `loadSummary(s)` body, after `api.pause()`):
```ts
      collapsedGroups.set(new Set())
```

(e) Add the method (after `toggleSelected(id) { ... }`):
```ts
    toggleGroup(key) {
      collapsedGroups.update((cur) => {
        const next = new Set(cur)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- "stores/trace" && npm run check
```
Expected: all store tests PASS; 0 check errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/stores/trace.ts frontend/src/stores/trace.test.ts
git commit -m "feat(frontend): collapsedGroups store state + toggleGroup"
```

---

## Task 3: Group-aware timeline layout

**Files:** Modify `frontend/src/lib/timelineLayout.ts`; Test `frontend/src/lib/timelineLayout.test.ts`.

- [ ] **Step 1: Write the failing test (append to timelineLayout.test.ts)**

Append:
```ts
import { layoutTimelineRows, hitGroupHeader, GROUP_HEADER_H } from './timelineLayout'
import { groupGoroutines } from './grouping'

describe('layoutTimelineRows', () => {
  const mk = (id: number, name: string) => ({
    id, name, createdAt: 0, endedAt: 100,
    intervals: [{ start: 0, end: 100, state: 'running', blockReason: '' }],
  })
  const summary = (gs: any[]) => ({ startTime: 0, endTime: 100, goroutines: gs, edges: [] }) as any
  const opts = { width: 200, laneHeight: 18, laneGap: 2 }

  it('emits a header row plus member lane rows for an expanded group', () => {
    const gs = [mk(1, 'main.w'), mk(2, 'main.w')]
    const rows = layoutTimelineRows(summary(gs), groupGoroutines(gs), new Set<string>(), opts)
    expect(rows.map((r) => r.kind)).toEqual(['header', 'lane', 'lane'])
    const header = rows[0] as Extract<typeof rows[number], { kind: 'header' }>
    expect(header.name).toBe('main.w')
    expect(header.count).toBe(2)
    expect(header.collapsed).toBe(false)
    expect(header.y).toBe(0)
    expect(header.height).toBe(GROUP_HEADER_H)
    // first member lane starts below the header
    expect((rows[1] as any).y).toBe(GROUP_HEADER_H + opts.laneGap)
  })

  it('emits only the header row for a collapsed group', () => {
    const gs = [mk(1, 'main.w'), mk(2, 'main.w')]
    const rows = layoutTimelineRows(summary(gs), groupGoroutines(gs), new Set(['main.w']), opts)
    expect(rows.map((r) => r.kind)).toEqual(['header'])
    expect((rows[0] as any).collapsed).toBe(true)
  })

  it('emits a bare lane row (no header) for a solo goroutine', () => {
    const gs = [mk(1, 'main.solo')]
    const rows = layoutTimelineRows(summary(gs), groupGoroutines(gs), new Set<string>(), opts)
    expect(rows.map((r) => r.kind)).toEqual(['lane'])
    expect((rows[0] as any).label).toBe('main.solo')
    expect((rows[0] as any).y).toBe(0)
  })
})

describe('hitGroupHeader', () => {
  const rows = [
    { kind: 'header', key: 'main.w', name: 'main.w', count: 2, collapsed: false, y: 0, height: 16 },
    { kind: 'lane', goroutineId: 1, y: 18, totalHeight: 18 },
  ] as any

  it('returns the header key when y is within a header row', () => {
    expect(hitGroupHeader(rows, 8)).toBe('main.w')
  })
  it('returns null when y is over a lane row', () => {
    expect(hitGroupHeader(rows, 25)).toBeNull()
  })
  it('returns null when y is past all rows', () => {
    expect(hitGroupHeader(rows, 999)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- timelineLayout
```
Expected: FAIL — `layoutTimelineRows`/`hitGroupHeader`/`GROUP_HEADER_H` not exported.

- [ ] **Step 3: Implement**

In `frontend/src/lib/timelineLayout.ts`:

(a) Add the import at the top (after the existing imports):
```ts
import type { GoroutineGroup } from './grouping'
```

(b) Add the row union type and header height constant (after the `Lane` interface):
```ts
export const GROUP_HEADER_H = 16

export type TimelineRow =
  | ({ kind: 'lane' } & Lane)
  | { kind: 'header'; key: string; name: string; count: number; collapsed: boolean; y: number; height: number }
```

(c) Extract a `buildLane` helper. Add this function (after `layoutTimeline`), which builds one lane at a given `y` using a shared scale + logs map:
```ts
import type { Goroutine } from './types' // ensure Goroutine is imported (add to the existing './types' import if missing)

// buildLane constructs a single goroutine's Lane at vertical offset y, using a
// pre-built time scale and a logs-by-goroutine map. Shared by layoutTimeline and
// layoutTimelineRows so lane geometry stays identical between them.
function buildLane(
  g: Goroutine,
  scale: ReturnType<typeof makeTimeScale>,
  regionRowH: number,
  laneHeight: number,
  logsByGo: Map<number, Log[]>,
  y: number,
): Lane {
  const rects: LayoutRect[] = (g.intervals ?? []).map((iv) => {
    const x = scale.toPixel(iv.start)
    return {
      x,
      width: Math.max(1, scale.toPixel(iv.end) - x),
      state: iv.state,
      color: stateColor(iv.state),
      blockReason: iv.blockReason ?? '',
    }
  })
  const regs = g.regions ?? []
  const regions: RegionRect[] = regs.map((r) => {
    const x = scale.toPixel(r.start)
    return { x, width: Math.max(1, scale.toPixel(r.end) - x), depth: r.depth, name: r.name, start: r.start, end: r.end }
  })
  const maxDepth = regs.reduce((m, r) => Math.max(m, r.depth), -1)
  const totalHeight = laneHeight + (maxDepth + 1) * regionRowH
  const logs: LogMarker[] = (logsByGo.get(g.id) ?? []).map((lg) => ({
    x: scale.toPixel(lg.time),
    category: lg.category,
    message: lg.message,
  }))
  return { goroutineId: g.id, label: goroutineLabel(g), y, height: laneHeight, totalHeight, rects, regions, logs }
}

// buildLogsByGo groups a summary's logs by goroutine id.
function buildLogsByGo(summary: TraceSummary): Map<number, Log[]> {
  const logsByGo = new Map<number, Log[]>()
  for (const lg of summary.logs ?? []) {
    const arr = logsByGo.get(lg.goId)
    if (arr) arr.push(lg)
    else logsByGo.set(lg.goId, [lg])
  }
  return logsByGo
}
```

(d) Rewrite the existing `layoutTimeline` body to delegate to the helpers (keeps its current `Lane[]` contract and all existing tests green):
```ts
export function layoutTimeline(summary: TraceSummary, opts: LayoutOptions): Lane[] {
  const gutter = opts.gutter ?? 0
  const regionRowH = opts.regionRowH ?? 0
  const scale = makeTimeScale(summary.startTime, summary.endTime, gutter, opts.width)
  const logsByGo = buildLogsByGo(summary)
  const lanes: Lane[] = []
  let y = opts.topOffset ?? 0
  for (const g of summary.goroutines) {
    const lane = buildLane(g, scale, regionRowH, opts.laneHeight, logsByGo, y)
    lanes.push(lane)
    y += lane.totalHeight + opts.laneGap
  }
  return lanes
}
```

(e) Add `layoutTimelineRows` (after `layoutTimeline`):
```ts
// layoutTimelineRows lays out grouped goroutines as an ordered row list: a real
// group (>=2 members) gets a header row, followed by its member lanes unless the
// group key is in collapsedKeys; a solo group (1 member) becomes a bare lane row.
// Lane geometry matches layoutTimeline exactly (shared buildLane).
export function layoutTimelineRows(
  summary: TraceSummary,
  groups: GoroutineGroup[],
  collapsedKeys: Set<string>,
  opts: LayoutOptions,
): TimelineRow[] {
  const gutter = opts.gutter ?? 0
  const regionRowH = opts.regionRowH ?? 0
  const scale = makeTimeScale(summary.startTime, summary.endTime, gutter, opts.width)
  const logsByGo = buildLogsByGo(summary)
  const rows: TimelineRow[] = []
  let y = opts.topOffset ?? 0
  for (const group of groups) {
    if (group.members.length >= 2) {
      const collapsed = collapsedKeys.has(group.key)
      rows.push({ kind: 'header', key: group.key, name: group.name, count: group.members.length, collapsed, y, height: GROUP_HEADER_H })
      y += GROUP_HEADER_H + opts.laneGap
      if (collapsed) continue
    }
    for (const g of group.members) {
      const lane = buildLane(g, scale, regionRowH, opts.laneHeight, logsByGo, y)
      rows.push({ kind: 'lane', ...lane })
      y += lane.totalHeight + opts.laneGap
    }
  }
  return rows
}

// hitGroupHeader returns the group key of the header row containing y, or null
// (the header row is full-width, so only y matters).
export function hitGroupHeader(rows: TimelineRow[], y: number): string | null {
  for (const r of rows) {
    if (r.kind === 'header' && y >= r.y && y < r.y + r.height) return r.key
  }
  return null
}
```

Note for the implementer: `makeTimeScale`, `stateColor`, `goroutineLabel`, `LayoutRect`, `RegionRect`, `LogMarker`, `Lane`, `Log`, `TraceSummary` are already imported/defined in this file. Only add the `GoroutineGroup` and (if missing) `Goroutine` type imports.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- timelineLayout && npm run check
```
Expected: all timelineLayout tests pass (old `layoutTimeline` blocks AND new `layoutTimelineRows`/`hitGroupHeader` blocks); 0 check errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/timelineLayout.ts frontend/src/lib/timelineLayout.test.ts
git commit -m "feat(frontend): group-aware timeline row layout + header hit-test"
```

---

## Task 4: TimelineCanvas group rendering (manual-verified)

Render header rows with a disclosure triangle, derive lanes from rows for the existing draw loops, and toggle collapse on header click. Then remove the now-unused `layoutTimeline`.

**Files:** Modify `frontend/src/components/TimelineCanvas.svelte`, `frontend/src/lib/timelineLayout.ts`, `frontend/src/lib/timelineLayout.test.ts`.

- [ ] **Step 1: Imports + constants + reactive rows/lanes**

In `frontend/src/components/TimelineCanvas.svelte`:

(a) Update imports. Change the timelineLayout import to bring in the new API, add the grouping import, and pull `collapsedGroups`/`toggleGroup` from the store:
```svelte
  import { layoutTimelineRows, hitGroupHeader, GROUP_HEADER_H, type TimelineRow, type Lane } from '../lib/timelineLayout'
  import { groupGoroutines } from '../lib/grouping'
```
and change the destructure of `traceStore` to include the new members:
```svelte
  const { summary, playhead, showSystem, selectedId, setPlayhead, collapsedGroups, toggleGroup } = traceStore
```

(b) Add a header color constant near the others (after `const TASK_ROW_H = 14`):
```svelte
  const GROUP_HEADER_BG = '#1b2130'
```

(c) Replace the reactive `lanes` block. The current block is:
```svelte
  $: lanes = $summary
    ? layoutTimeline(
        { ...$summary, goroutines: visible },
        { width: cssWidth, laneHeight: LANE_H, laneGap: LANE_GAP, gutter: GUTTER_W, regionRowH: REGION_ROW_H, topOffset: taskTrack.height },
      )
    : ([] as Lane[])
  $: cssHeight = lanes.length
    ? Math.max(400, lanes[lanes.length - 1].y + lanes[lanes.length - 1].totalHeight)
    : 400
```
Replace with:
```svelte
  $: rows = $summary
    ? layoutTimelineRows(
        { ...$summary, goroutines: visible },
        groupGoroutines(visible),
        $collapsedGroups,
        { width: cssWidth, laneHeight: LANE_H, laneGap: LANE_GAP, gutter: GUTTER_W, regionRowH: REGION_ROW_H, topOffset: taskTrack.height },
      )
    : ([] as TimelineRow[])
  $: lanes = rows.filter((r): r is { kind: 'lane' } & Lane => r.kind === 'lane')
  $: headers = rows.filter((r) => r.kind === 'header') as Extract<TimelineRow, { kind: 'header' }>[]
  $: cssHeight = rows.length
    ? Math.max(400, (() => { const last = rows[rows.length - 1]; return last.kind === 'lane' ? last.y + last.totalHeight : last.y + last.height })())
    : 400
```

(d) Add `$collapsedGroups` to the redraw trigger. Change:
```svelte
  $: void [$playhead, lanes, cssWidth, cssHeight, $selectedId, taskTrack, chain], draw()
```
to:
```svelte
  $: void [$playhead, lanes, headers, cssWidth, cssHeight, $selectedId, taskTrack], draw()
```
(Note: this branch's actual current trigger ends with `taskTrack, chain]` — `chain` is from the merged causal-focus feature. Keep `chain` if present; the point is to ADD `headers` and ensure `$collapsedGroups` drives a redraw via `rows`→`lanes`/`headers`. Final form: `$: void [$playhead, lanes, headers, cssWidth, cssHeight, $selectedId, taskTrack, chain], draw()`.)

- [ ] **Step 2: Draw header rows**

In `draw()`, after the task-track block and BEFORE the `// State bars.` loop, insert a header-drawing block:
```svelte
    // Group header rows: a disclosure triangle + "name ×count" on a faint band.
    ctx.textBaseline = 'middle'
    ctx.font = '11px system-ui, sans-serif'
    for (const h of headers) {
      ctx.fillStyle = GROUP_HEADER_BG
      ctx.fillRect(0, h.y, cssWidth, h.height)
      ctx.fillStyle = '#cdd3df'
      ctx.fillText(`${h.collapsed ? '▸' : '▾'} ${h.name} ×${h.count}`, 6, h.y + h.height / 2)
    }
```

- [ ] **Step 3: Header click toggles collapse**

In `onPointerDown`, before the existing `setPlayhead(...)` logic, insert a header hit check. The current handler is:
```svelte
  function onPointerDown(e: PointerEvent) {
    dragging = true
    setPlayhead(timeAtClientX(e.clientX))
  }
```
Replace with:
```svelte
  function onPointerDown(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect()
    const key = hitGroupHeader(rows, e.clientY - rect.top)
    if (key !== null) {
      toggleGroup(key)
      return // header click toggles collapse; do not scrub the playhead
    }
    dragging = true
    setPlayhead(timeAtClientX(e.clientX))
  }
```

- [ ] **Step 4: Remove the now-unused `layoutTimeline`**

The component no longer calls `layoutTimeline`. Remove the dead export and its old test blocks (the lane math is now covered by the `layoutTimelineRows` tests added in Task 3).

(a) In `frontend/src/lib/timelineLayout.ts`, delete the entire `export function layoutTimeline(...) { ... }` function (the version that delegates to `buildLane`). Keep `buildLane`, `buildLogsByGo`, `layoutTimelineRows`, `hitGroupHeader`, and all types.

(b) In `frontend/src/lib/timelineLayout.test.ts`, remove the four `describe('layoutTimeline', ...)`, `describe('layoutTimeline gutter', ...)`, `describe('layoutTimeline topOffset', ...)`, and `describe('layoutTimeline regions and logs', ...)` blocks and the now-unused `import { layoutTimeline } from './timelineLayout'` (keep the `layoutTimelineRows`/`hitGroupHeader`/`GROUP_HEADER_H` import). The `layoutTimelineRows` tests cover lane x/width, regions, and y-stacking via solo and grouped inputs.

If, after removal, `npm run check` reports `layoutTimeline` is still referenced anywhere, restore it instead and report DONE_WITH_CONCERNS — do not leave a broken import.

- [ ] **Step 5: Type-check, test, build**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm run check && npm test
cd /Users/user/GolandProjects/trace-go
wails build
```
Expected: 0 check errors; all unit suites pass; `wails build` succeeds. After build, revert spurious generated files: `git checkout -- frontend/dist/gitkeep frontend/wailsjs/runtime/`.

- [ ] **Step 6: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/components/TimelineCanvas.svelte frontend/src/lib/timelineLayout.ts frontend/src/lib/timelineLayout.test.ts
git commit -m "feat(frontend): render foldable goroutine group headers in the timeline"
```

- [ ] **Step 7: Manual visual verification (human)**

Open a trace with repeated workers (e.g. `~/Desktop/trace-tasks.out` has six `main.main.func2`). Run the app (`open build/bin/trace-go.app`), open the trace, then:
1. **Group header** — the six `main.main.func2` lanes are preceded by a header row `▾ main.main.func2 ×6` on a faint band; the member lanes show below it (default expanded).
2. **Collapse** — click the header: it becomes `▸ main.main.func2 ×6` and the six member lanes disappear; the rows below shift up. The playhead does NOT jump on that click.
3. **Expand** — click again: `▾` returns and the six lanes reappear.
4. **Solo lanes unaffected** — `g1` (main) has no header and renders as before.
5. **No regression** — playhead scrub, selection outline, TASKS track, causal focus (click a graph node → timeline lanes dim) all still work; headers stay full opacity during focus.

Report observations. If the app can't launch, report DONE_WITH_CONCERNS noting build + type-check + unit tests passed and only the live check remains.

---

## Self-Review Notes

- **Spec coverage:** pure `groupGoroutines` (spec §2) → Task 1; store `collapsedGroups`/`toggleGroup`/reset (spec §4) → Task 2; group-aware `TimelineRow[]` layout + `hitGroupHeader` (spec §3) → Task 3; header render + click toggle, lanes via row filter (spec §5) → Task 4.
- **Placeholder scan:** none — every step shows concrete code.
- **Type consistency:** `GoroutineGroup {key,name,members}` (Task 1) is consumed by `layoutTimelineRows` (Task 3) and `groupGoroutines` in the component (Task 4). `TimelineRow` union, `GROUP_HEADER_H`, `hitGroupHeader(rows, y)` defined in Task 3 and used in Task 4. `collapsedGroups: Writable<Set<string>>` + `toggleGroup(key)` defined in Task 2 and used in Task 4. `buildLane` shared by `layoutTimeline` (Task 3, then removed Task 4) and `layoutTimelineRows`.
- **Invariant preserved:** default expanded + empty `collapsedGroups` → first paint adds only one header row per real group, hides no detail. Lanes derived by `rows.filter(kind==='lane')` feed the existing draw loops unchanged, so state bars / regions / logs / labels / selection outline / playhead / causal-focus dim are untouched. Headers drawn full opacity.
- **No transient break:** Task 3 keeps `layoutTimeline` working (delegates to `buildLane`) so build+tests stay green; Task 4 removes it only after the component migrates, and re-checks references before deleting.
- **Stage 2 foundation:** `collapsedGroups` lives in the store keyed by start-function name (same key `groupGoroutines` produces), so a later graph super-node stage reads the same state with no rework.
