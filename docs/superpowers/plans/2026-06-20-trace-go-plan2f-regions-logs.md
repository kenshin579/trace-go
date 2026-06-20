# trace-go Plan 2F — Timeline Regions + Logs (B4-1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse `runtime/trace` **regions** (named, nestable time spans within one goroutine) and **logs** (point events) and render them on the timeline — regions as sub-rows under each goroutine's state bar, logs as markers — with hover tooltips.

**Architecture:** The Go parser gains region (per-goroutine depth stack) and log handling in its existing single pass; the model gains `Region`/`Log`. The frontend's timeline layout becomes **variable-height** (a goroutine with regions grows by its nesting depth), computed in a pure, unit-tested function; hit-testing and tooltips extend to regions/logs. The graph, store, playback, and filter are untouched.

**Tech Stack:** Go 1.26 (`golang.org/x/exp/trace`), Svelte 3 + TypeScript + Vite, Vitest, Canvas 2D.

**Spec:** `docs/superpowers/specs/2026-06-20-regions-logs-design.md`. Scope = regions + logs on the timeline (B4-1). **Tasks** (cross-goroutine) and the **graph task clusters** are B4-2 (separate plan). Plans 1, 2A–2E are merged; 64 vitest + the Go suite pass.

**Note on a transient break:** Tasks 4–5 change the shared `Lane` shape and the `hitTimeline` signature that `TimelineCanvas.svelte` consumes. `npm run check` (svelte-check) will report errors in `TimelineCanvas.svelte` until **Task 7** rewrites it. During Tasks 3–6, validate with `npm test` (Vitest, the pure modules); `npm run check` goes green again at Task 7. This mirrors how earlier plans handled mid-plan component breaks.

---

## File Structure

- `internal/model/model.go` — **modify**: add `Region`, `Log`; `Goroutine.Regions`, `TraceSummary.Logs`.
- `internal/parse/parse.go` — **modify**: handle `EventRegionBegin/End` (depth stack) + `EventLog`.
- `internal/parse/testutil_test.go` — **modify**: a scenario emitting nested regions + logs.
- `internal/parse/parse_test.go` — **modify**: region/log invariant tests.
- `frontend/src/lib/types.ts` — **modify**: mirror `Region`/`Log`.
- `frontend/src/lib/timelineLayout.ts` — **modify**: variable-height lanes + region rects + log markers.
- `frontend/src/lib/hit.ts` — **modify**: variable-height `hitTimeline` returning interval/region/log hits.
- `frontend/src/lib/tooltip.ts` — **modify**: `regionTooltip`, `logTooltip`.
- `frontend/src/components/TimelineCanvas.svelte` — **modify**: draw region sub-rows + log markers, variable heights, region/log hover.

---

## Task 1: Model — Region and Log types

**Files:** Modify `internal/model/model.go`; Test `internal/model/model_test.go`.

- [ ] **Step 1: Write the failing test (append to existing file)**

Append to `internal/model/model_test.go`:
```go
func TestRegionAndLogJSON(t *testing.T) {
	sum := TraceSummary{
		Goroutines: []Goroutine{{
			ID:      1,
			Regions: []Region{{Start: 10, End: 50, Name: "db-query", Depth: 1}},
		}},
		Logs: []Log{{Time: 20, GoID: 1, Category: "cache", Message: "miss"}},
	}
	b, err := json.Marshal(sum)
	if err != nil {
		t.Fatal(err)
	}
	var out TraceSummary
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	if out.Goroutines[0].Regions[0].Name != "db-query" || out.Goroutines[0].Regions[0].Depth != 1 {
		t.Fatalf("region round trip lost data: %+v", out.Goroutines[0].Regions)
	}
	if out.Logs[0].Category != "cache" || out.Logs[0].Message != "miss" {
		t.Fatalf("log round trip lost data: %+v", out.Logs)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go
go test ./internal/model/ -run TestRegionAndLogJSON
```
Expected: FAIL — `Region`/`Log` undefined, `Regions`/`Logs` fields missing.

- [ ] **Step 3: Add the types and fields**

In `internal/model/model.go`, add these two types (place them after the `Interval` type):
```go
// Region is a named, nestable time span within a single goroutine, from a
// runtime/trace.WithRegion/StartRegion call.
type Region struct {
	Start Time   `json:"start"`
	End   Time   `json:"end"`
	Name  string `json:"name"`  // the region type string passed to WithRegion
	Depth int    `json:"depth"` // nesting depth, 0 = outermost
}

// Log is a point-in-time event from a runtime/trace.Log/Logf call.
type Log struct {
	Time     Time   `json:"time"`
	GoID     int64  `json:"goId"`
	Category string `json:"category"`
	Message  string `json:"message"`
}
```
Add a field to the `Goroutine` struct (after `Intervals`):
```go
	Regions []Region `json:"regions,omitempty"`
```
Add a field to the `TraceSummary` struct (after `Edges`):
```go
	Logs []Log `json:"logs,omitempty"`
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go
go test ./internal/model/
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add internal/model/
git commit -m "feat(model): add Region and Log types"
```

---

## Task 2: Parser — regions and logs

**Files:** Modify `internal/parse/parse.go`, `internal/parse/testutil_test.go`, `internal/parse/parse_test.go`.

- [ ] **Step 1: Add a scenario emitting regions + logs (testutil)**

In `internal/parse/testutil_test.go`, add the `context`/`runtime/trace` usage. Add this scenario function (and ensure `"context"` is imported):
```go
// scenarioRegionsLogs emits nested user regions and logs on the running goroutine.
func scenarioRegionsLogs() {
	ctx := context.Background()
	trace.Log(ctx, "startup", "begin")
	trace.WithRegion(ctx, "outer", func() {
		trace.WithRegion(ctx, "inner", func() {
			trace.Log(ctx, "work", "step")
		})
	})
}
```
(If `context` is not yet imported in the file, add `"context"` to its import block. `runtime/trace` is already imported as `trace`.)

- [ ] **Step 2: Write the failing parser test (append to parse_test.go)**

Append to `internal/parse/parse_test.go`:
```go
func TestParseRegionsAndLogs(t *testing.T) {
	r := genTrace(t, scenarioRegionsLogs)
	sum, err := parse.Parse(r)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}

	// Find the goroutine that has regions and assert nesting.
	var outer, inner *model.Region
	for gi := range sum.Goroutines {
		for ri := range sum.Goroutines[gi].Regions {
			reg := &sum.Goroutines[gi].Regions[ri]
			switch reg.Name {
			case "outer":
				outer = reg
			case "inner":
				inner = reg
			}
		}
	}
	if outer == nil || inner == nil {
		t.Fatalf("expected 'outer' and 'inner' regions, got %+v", sum.Goroutines)
	}
	if inner.Depth <= outer.Depth {
		t.Fatalf("expected inner deeper than outer: outer=%d inner=%d", outer.Depth, inner.Depth)
	}
	if outer.End < outer.Start || inner.End < inner.Start {
		t.Fatalf("region end before start: outer=%+v inner=%+v", outer, inner)
	}

	cats := map[string]bool{}
	for _, lg := range sum.Logs {
		cats[lg.Category] = true
		if lg.Message == "" {
			t.Fatalf("log missing message: %+v", lg)
		}
	}
	if !cats["startup"] || !cats["work"] {
		t.Fatalf("expected 'startup' and 'work' log categories, got %+v", sum.Logs)
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go
go test ./internal/parse/ -run TestParseRegionsAndLogs
```
Expected: FAIL — no regions/logs are parsed yet (the loop ignores those events).

- [ ] **Step 4: Implement region/log handling in the parser**

In `internal/parse/parse.go`:

(a) Add a field to the `gobuilder` struct (after `openStart`):
```go
	regionStack []openRegion // in-progress (unclosed) regions for this goroutine
```
and add this helper type just above `gobuilder`:
```go
// openRegion is an in-progress region awaiting its EventRegionEnd.
type openRegion struct {
	name  string
	start model.Time
	depth int
}
```

(b) Declare a logs slice next to the other accumulators in `Parse` (after `var edges []model.CausalEdge`):
```go
	var logs []model.Log
```

(c) Handle the new events. Immediately AFTER the time min/max block and BEFORE the existing `if ev.Kind() != exptrace.EventStateTransition { continue }` line, insert:
```go
		switch ev.Kind() {
		case exptrace.EventRegionBegin:
			gid := int64(ev.Goroutine())
			if gid != int64(exptrace.NoGoroutine) {
				b := get(gid)
				b.regionStack = append(b.regionStack, openRegion{
					name:  ev.Region().Type,
					start: now,
					depth: len(b.regionStack),
				})
			}
			continue
		case exptrace.EventRegionEnd:
			gid := int64(ev.Goroutine())
			if gid != int64(exptrace.NoGoroutine) {
				b := get(gid)
				if n := len(b.regionStack); n > 0 {
					reg := b.regionStack[n-1]
					b.regionStack = b.regionStack[:n-1]
					b.g.Regions = append(b.g.Regions, model.Region{
						Start: reg.start, End: now, Name: reg.name, Depth: reg.depth,
					})
				}
			}
			continue
		case exptrace.EventLog:
			lg := ev.Log()
			logs = append(logs, model.Log{
				Time: now, GoID: int64(ev.Goroutine()), Category: lg.Category, Message: lg.Message,
			})
			continue
		}
```

(d) Close unclosed regions at trace end. In the existing "Close intervals still open at trace end" loop, ADD region flushing — change that loop body so it also drains `regionStack`:
```go
	for _, b := range builders {
		if b.hasOpen {
			iv := model.Interval{Start: b.openStart, End: maxT, State: b.curState}
			if b.curState == model.StateBlocked {
				iv.BlockReason = b.curReason
			}
			b.g.Intervals = append(b.g.Intervals, iv)
			b.hasOpen = false
		}
		for _, reg := range b.regionStack {
			b.g.Regions = append(b.g.Regions, model.Region{
				Start: reg.start, End: maxT, Name: reg.name, Depth: reg.depth,
			})
		}
		b.regionStack = nil
		sort.Slice(b.g.Regions, func(i, j int) bool { return b.g.Regions[i].Start < b.g.Regions[j].Start })
	}
```

(e) Attach logs to the summary, sorted by time. Change the final `return` to set `Logs`:
```go
	sort.Slice(logs, func(i, j int) bool { return logs[i].Time < logs[j].Time })
	return &model.TraceSummary{
		StartTime:  minT,
		EndTime:    maxT,
		Goroutines: gs,
		Edges:      edges,
		Logs:       logs,
	}, nil
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
cd /Users/user/GolandProjects/trace-go
go test ./internal/parse/ -run TestParseRegionsAndLogs -v
go test ./internal/...
```
Expected: the new test PASSES; all existing parse/model/causality tests still pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add internal/parse/
git commit -m "feat(parse): parse user regions (nested) and logs"
```

---

## Task 3: Frontend types mirror

**Files:** Modify `frontend/src/lib/types.ts`.

- [ ] **Step 1: Add the types**

In `frontend/src/lib/types.ts`, add:
```ts
export interface Region {
  start: number
  end: number
  name: string
  depth: number
}

export interface Log {
  time: number
  goId: number
  category: string
  message: string
}
```
Add `regions?: Region[]` to the `Goroutine` interface (after `intervals`):
```ts
  regions?: Region[]
```
Add `logs?: Log[]` to the `TraceSummary` interface (after `edges`):
```ts
  logs?: Log[]
```

- [ ] **Step 2: Type-check the libs (component break is expected later, not here)**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test
```
Expected: all existing unit suites still pass (this is a pure type addition).

- [ ] **Step 3: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/types.ts
git commit -m "feat(frontend): mirror Region and Log types"
```

---

## Task 4: Variable-height timeline layout

Rewrites `layoutTimeline` to stack lanes by their own height (state row + one row per nesting depth) and attach region rects + log markers. Existing callers that pass goroutines without `regions` and summaries without `logs` get the old compact behavior.

**Files:** Modify `frontend/src/lib/timelineLayout.ts`; Test `frontend/src/lib/timelineLayout.test.ts`.

- [ ] **Step 1: Write the failing tests (append to existing file)**

Append to `frontend/src/lib/timelineLayout.test.ts`:
```ts
describe('layoutTimeline regions and logs', () => {
  const summary = {
    startTime: 0,
    endTime: 100,
    goroutines: [
      {
        id: 1, name: 'a', createdAt: 0, endedAt: 100,
        intervals: [{ start: 0, end: 100, state: 'running', blockReason: '' }],
        regions: [
          { start: 0, end: 60, name: 'outer', depth: 0 },
          { start: 10, end: 40, name: 'inner', depth: 1 },
        ],
      },
      {
        id: 2, name: 'b', createdAt: 0, endedAt: 100,
        intervals: [{ start: 0, end: 100, state: 'running', blockReason: '' }],
      },
    ],
    logs: [{ time: 50, goId: 1, category: 'c', message: 'm' }],
  } as any

  const opts = { width: 200, laneHeight: 18, laneGap: 4, gutter: 0, regionRowH: 8 }

  it('grows a lane with regions by (maxDepth+1) region rows, leaves others compact', () => {
    const lanes = layoutTimeline(summary, opts)
    // lane 0 has regions up to depth 1 -> 2 region rows: height = 18 + 2*8 = 34
    expect(lanes[0].height).toBe(18) // state row height stays laneHeight
    expect(lanes[0].totalHeight).toBe(34)
    // lane 1 has no regions -> compact
    expect(lanes[1].totalHeight).toBe(18)
  })

  it('stacks lanes by cumulative total height + gap', () => {
    const lanes = layoutTimeline(summary, opts)
    expect(lanes[0].y).toBe(0)
    expect(lanes[1].y).toBe(34 + 4) // lane0 totalHeight + gap
  })

  it('maps region spans to x/width and carries depth + name', () => {
    const lanes = layoutTimeline(summary, opts)
    const inner = lanes[0].regions.find((r) => r.name === 'inner')!
    expect(inner.depth).toBe(1)
    expect(inner.x).toBe(20) // t=10 of span 100 over width 200
    expect(inner.width).toBeCloseTo(60) // (40-10)/100 * 200
  })

  it('places log markers for the owning goroutine at the log time', () => {
    const lanes = layoutTimeline(summary, opts)
    expect(lanes[0].logs).toHaveLength(1)
    expect(lanes[0].logs[0].x).toBe(100) // t=50 of span 100 over width 200
    expect(lanes[1].logs).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- timelineLayout
```
Expected: FAIL — `totalHeight`/`regions`/`logs` not produced; `regionRowH` ignored.

- [ ] **Step 3: Rewrite the layout module**

Replace `frontend/src/lib/timelineLayout.ts` with:
```ts
import { makeTimeScale } from './timeMap'
import { goroutineLabel, stateColor, type IntervalState } from './format'
import type { TraceSummary, Log } from './types'

export interface LayoutRect {
  x: number
  width: number
  state: IntervalState
  color: string
  blockReason: string
}

export interface RegionRect {
  x: number
  width: number
  depth: number
  name: string
  start: number // real trace time (ns), for an accurate hover duration
  end: number
}

export interface LogMarker {
  x: number
  category: string
  message: string
}

export interface Lane {
  goroutineId: number
  label: string
  y: number
  height: number // state row height (state intervals are drawn at this height)
  totalHeight: number // state row + region rows
  rects: LayoutRect[]
  regions: RegionRect[]
  logs: LogMarker[]
}

export interface LayoutOptions {
  width: number // pixel width of the time axis
  laneHeight: number
  laneGap: number
  gutter?: number // left offset reserved for lane labels
  regionRowH?: number // height of one region sub-row (0/undefined => no region rows)
}

// layoutTimeline maps the trace span onto [gutter, width] and stacks one lane per
// goroutine. A goroutine with regions grows by (maxDepth+1) region rows; others
// stay at laneHeight. Region spans and the goroutine's logs are attached per lane.
export function layoutTimeline(summary: TraceSummary, opts: LayoutOptions): Lane[] {
  const gutter = opts.gutter ?? 0
  const regionRowH = opts.regionRowH ?? 0
  const scale = makeTimeScale(summary.startTime, summary.endTime, gutter, opts.width)

  const logsByGo = new Map<number, Log[]>()
  for (const lg of summary.logs ?? []) {
    const arr = logsByGo.get(lg.goId)
    if (arr) arr.push(lg)
    else logsByGo.set(lg.goId, [lg])
  }

  const lanes: Lane[] = []
  let y = 0
  for (const g of summary.goroutines) {
    const rects: LayoutRect[] = g.intervals.map((iv) => {
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
      return {
        x,
        width: Math.max(1, scale.toPixel(r.end) - x),
        depth: r.depth,
        name: r.name,
        start: r.start,
        end: r.end,
      }
    })
    const maxDepth = regs.reduce((m, r) => Math.max(m, r.depth), -1)
    const regionRows = maxDepth + 1 // -1 => 0 rows when no regions
    const totalHeight = opts.laneHeight + regionRows * regionRowH

    const logs: LogMarker[] = (logsByGo.get(g.id) ?? []).map((lg) => ({
      x: scale.toPixel(lg.time),
      category: lg.category,
      message: lg.message,
    }))

    lanes.push({
      goroutineId: g.id,
      label: goroutineLabel(g),
      y,
      height: opts.laneHeight,
      totalHeight,
      rects,
      regions,
      logs,
    })
    y += totalHeight + opts.laneGap
  }
  return lanes
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- timelineLayout
```
Expected: all timelineLayout tests PASS (existing gutter/basic tests still pass — `totalHeight` equals `laneHeight` when there are no regions, and `y` stacking matches because old tests have no regions).

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/timelineLayout.ts frontend/src/lib/timelineLayout.test.ts
git commit -m "feat(frontend): variable-height timeline layout with regions and logs"
```

---

## Task 5: Hit-testing for variable heights + regions/logs

**Files:** Modify `frontend/src/lib/hit.ts`; Test `frontend/src/lib/hit.test.ts`.

- [ ] **Step 1: Write the failing tests (replace the hitTimeline describe block)**

In `frontend/src/lib/hit.test.ts`, replace the existing `describe('hitTimeline', ...)` block with:
```ts
import type { Lane } from './timelineLayout'

const laneA: Lane = {
  goroutineId: 1, label: 'a', y: 0, height: 18, totalHeight: 26,
  rects: [{ x: 0, width: 100, state: 'running', color: '#0a0', blockReason: '' }],
  regions: [{ x: 10, width: 40, depth: 0, name: 'db', start: 100, end: 500 }],
  logs: [{ x: 70, category: 'c', message: 'm' }],
}
const laneB: Lane = {
  goroutineId: 2, label: 'b', y: 30, height: 18, totalHeight: 18,
  rects: [{ x: 0, width: 100, state: 'running', color: '#0a0', blockReason: '' }],
  regions: [], logs: [],
}
const lanes = [laneA, laneB]

describe('hitTimeline', () => {
  const RR = 8 // regionRowH

  it('hits a state interval in the state row', () => {
    const h = hitTimeline(lanes, 50, 5, RR)
    expect(h?.kind).toBe('interval')
    expect(h?.kind === 'interval' && h.rect.width).toBe(100)
  })
  it('hits a log marker near its x in the state row', () => {
    const h = hitTimeline(lanes, 71, 4, RR)
    expect(h?.kind).toBe('log')
    expect(h?.kind === 'log' && h.log.message).toBe('m')
  })
  it('hits a region in the region row below the state row', () => {
    const h = hitTimeline(lanes, 30, 22, RR) // y in [18, 26) -> depth 0 region row
    expect(h?.kind).toBe('region')
    expect(h?.kind === 'region' && h.region.name).toBe('db')
  })
  it('returns null in the gap between lanes', () => {
    expect(hitTimeline(lanes, 50, 28, RR)).toBeNull() // y 26..30 is the gap
  })
  it('resolves the second lane by its own y range', () => {
    const h = hitTimeline(lanes, 50, 35, RR)
    expect(h?.kind).toBe('interval')
    expect(h?.lane.goroutineId).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- hit
```
Expected: FAIL — the old `hitTimeline` signature/return doesn't match.

- [ ] **Step 3: Rewrite hitTimeline (keep nodeAtPoint + distToSegment unchanged)**

In `frontend/src/lib/hit.ts`, replace the `TimelineHit` interface and `hitTimeline` function (leave `nodeAtPoint` and `distToSegment` exactly as they are). New code:
```ts
import type { Lane, LayoutRect, RegionRect, LogMarker } from './timelineLayout'

export type TimelineHit =
  | { kind: 'interval'; lane: Lane; rect: LayoutRect }
  | { kind: 'region'; lane: Lane; region: RegionRect }
  | { kind: 'log'; lane: Lane; log: LogMarker }
  | null

const LOG_HIT_PX = 5

// hitTimeline finds what is under a point in timeline canvas coordinates, using
// each lane's own y/totalHeight (lanes are variable-height). A log marker in the
// state row wins over the interval beneath it; region rows sit below the state row.
export function hitTimeline(lanes: Lane[], x: number, y: number, regionRowH: number): TimelineHit {
  const lane = lanes.find((l) => y >= l.y && y < l.y + l.totalHeight)
  if (!lane) return null
  const localY = y - lane.y

  if (localY < lane.height) {
    // State row: a nearby log marker wins, else the interval under x.
    const log = lane.logs.find((lg) => Math.abs(lg.x - x) <= LOG_HIT_PX)
    if (log) return { kind: 'log', lane, log }
    const rect = lane.rects.find((r) => x >= r.x && x < r.x + r.width)
    return rect ? { kind: 'interval', lane, rect } : null
  }

  // Region rows below the state row.
  const depth = Math.floor((localY - lane.height) / regionRowH)
  const region = lane.regions.find((r) => r.depth === depth && x >= r.x && x < r.x + r.width)
  return region ? { kind: 'region', lane, region } : null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- hit
```
Expected: all hit tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/hit.ts frontend/src/lib/hit.test.ts
git commit -m "feat(frontend): variable-height hit-testing for intervals/regions/logs"
```

---

## Task 6: Region and log tooltips

**Files:** Modify `frontend/src/lib/tooltip.ts`; Test `frontend/src/lib/tooltip.test.ts`.

- [ ] **Step 1: Write the failing tests (append to existing file)**

Append to `frontend/src/lib/tooltip.test.ts`:
```ts
import { regionTooltip, logTooltip } from './tooltip'

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- tooltip
```
Expected: FAIL — `regionTooltip`/`logTooltip` not exported.

- [ ] **Step 3: Add the builders (append to tooltip.ts)**

Append to `frontend/src/lib/tooltip.ts`:
```ts
// regionTooltip shows a hovered region's name and its duration (ms, 3 decimals).
export function regionTooltip(name: string, start: number, end: number): string {
  return `${name}\n${((end - start) / 1e6).toFixed(3)} ms`
}

// logTooltip shows a hovered log's category and message on two lines.
export function logTooltip(category: string, message: string): string {
  return `${category}\n${message}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- tooltip
```
Expected: all tooltip tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/tooltip.ts frontend/src/lib/tooltip.test.ts
git commit -m "feat(frontend): add region and log tooltip builders"
```

---

## Task 7: TimelineCanvas — draw regions/logs, variable heights (manual-verified)

Adopts the new `Lane` shape and `hitTimeline`: variable lane heights, region sub-rows, log markers, region/log hover. This is what restores `npm run check` to green.

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
  import { intervalTooltip, regionTooltip, logTooltip } from '../lib/tooltip'

  const { summary, playhead, showSystem, selectedId, setPlayhead } = traceStore

  let container: HTMLDivElement
  let canvas: HTMLCanvasElement
  let cssWidth = 800
  const LANE_H = 18
  const LANE_GAP = 3
  const GUTTER_W = 120
  const REGION_ROW_H = 9
  const REGION_COLOR = '#5a6b8c'
  const LOG_COLOR = '#e0c030'

  let dragging = false
  let tip: { text: string; x: number; y: number } | null = null

  $: visible = $summary ? visibleGoroutines($summary, $showSystem) : []
  $: lanes = $summary
    ? layoutTimeline(
        { ...$summary, goroutines: visible },
        { width: cssWidth, laneHeight: LANE_H, laneGap: LANE_GAP, gutter: GUTTER_W, regionRowH: REGION_ROW_H },
      )
    : ([] as Lane[])
  $: cssHeight = lanes.length
    ? Math.max(400, lanes[lanes.length - 1].y + lanes[lanes.length - 1].totalHeight)
    : 400

  $: void [$playhead, lanes, cssWidth, cssHeight, $selectedId], draw()

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

    // State bars.
    for (const lane of lanes) {
      for (const r of lane.rects) {
        ctx.fillStyle = r.color
        ctx.fillRect(r.x, lane.y, r.width, lane.height)
      }
    }

    // Region sub-rows.
    ctx.font = '9px system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    for (const lane of lanes) {
      for (const reg of lane.regions) {
        const ry = lane.y + lane.height + reg.depth * REGION_ROW_H
        ctx.fillStyle = REGION_COLOR
        ctx.fillRect(reg.x, ry + 1, reg.width, REGION_ROW_H - 2)
        if (reg.width > 14) {
          ctx.fillStyle = '#e6ebf2'
          ctx.fillText(fitLabel(ctx, reg.name, reg.width - 4), reg.x + 3, ry + REGION_ROW_H / 2)
        }
      }
    }

    // Log markers (small diamonds on the top edge of the state row).
    for (const lane of lanes) {
      for (const lg of lane.logs) {
        const my = lane.y + 4
        ctx.fillStyle = LOG_COLOR
        ctx.beginPath()
        ctx.moveTo(lg.x, my - 3)
        ctx.lineTo(lg.x + 3, my)
        ctx.lineTo(lg.x, my + 3)
        ctx.lineTo(lg.x - 3, my)
        ctx.closePath()
        ctx.fill()
      }
    }

    // Lane labels in the gutter.
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillStyle = '#cdd3df'
    for (const lane of lanes) {
      ctx.fillText(fitLabel(ctx, lane.label, GUTTER_W - 10), 4, lane.y + lane.height / 2)
    }

    // Selected lane outline (full lane incl. region rows).
    for (const lane of lanes) {
      if (lane.goroutineId === $selectedId) {
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.strokeRect(GUTTER_W + 0.5, lane.y + 0.5, cssWidth - GUTTER_W - 1, lane.totalHeight - 1)
      }
    }

    // Playhead.
    if ($summary && lanes.length) {
      const scale = makeTimeScale($summary.startTime, $summary.endTime, GUTTER_W, cssWidth)
      const x = scale.toPixel($playhead)
      const bottom = lanes[lanes.length - 1].y + lanes[lanes.length - 1].totalHeight
      ctx.strokeStyle = '#5b8def'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, bottom)
      ctx.stroke()
    }
  }

  function timeAtClientX(clientX: number): number {
    if (!$summary) return 0
    const rect = canvas.getBoundingClientRect()
    const scale = makeTimeScale($summary.startTime, $summary.endTime, GUTTER_W, cssWidth)
    return scale.toTime(clientX - rect.left)
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
    const h = hitTimeline(lanes, x, y, REGION_ROW_H)
    if (!h) {
      tip = null
    } else if (h.kind === 'interval') {
      tip = { text: intervalTooltip(h.lane.label, h.rect.state, h.rect.blockReason), x, y }
    } else if (h.kind === 'region') {
      tip = { text: regionTooltip(h.region.name, h.region.start, h.region.end), x, y }
    } else {
      tip = { text: logTooltip(h.log.category, h.log.message), x, y }
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

- [ ] **Step 2: Type-check and run the full unit suite**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm run check && npm test
```
Expected: `svelte-check` 0 errors (the transient TimelineCanvas break from Tasks 4–5 is now resolved); all unit suites pass.

- [ ] **Step 3: Build the app**

Run:
```bash
cd /Users/user/GolandProjects/trace-go
wails build
```
Expected: builds successfully.

- [ ] **Step 4: Manual visual verification (human)**

Generate a trace WITH annotations and open it. Run:
```bash
mkdir -p /tmp/tgr && cat > /tmp/tgr/main.go <<'GO'
package main

import (
	"context"
	"os"
	"runtime/trace"
	"sync"
	"time"
)

func main() {
	f, _ := os.Create("/tmp/tgr/trace.out")
	trace.Start(f)
	defer func() { trace.Stop(); f.Close() }()
	ctx := context.Background()
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			trace.WithRegion(ctx, "handle", func() {
				trace.Log(ctx, "req", "start")
				trace.WithRegion(ctx, "db-query", func() { time.Sleep(time.Millisecond) })
				trace.Log(ctx, "req", "done")
			})
		}(i)
	}
	wg.Wait()
}
GO
( cd /tmp/tgr && go run main.go ) && cp /tmp/tgr/trace.out ~/Desktop/trace-annotated.out && echo "ready: ~/Desktop/trace-annotated.out"
```
Then open `~/Desktop/trace-annotated.out` in the app and confirm:
1. Goroutines that ran regions show **sub-rows under their state bar** — `handle` (depth 0) with `db-query` (depth 1) nested beneath; goroutines without regions stay compact.
2. **Log markers** (amber diamonds) sit on the state row; hovering one shows `category` + `message`.
3. Hovering a **region** shows its name + duration; hovering a state interval still shows state + block reason.
4. With the taller lanes, the **playhead, scrub, selection outline, and gutter labels all still line up** correctly.

Report observations. If `wails dev` can't launch, report DONE_WITH_CONCERNS noting build + type-check + unit tests passed and only the live check remains.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/components/TimelineCanvas.svelte
git commit -m "feat(frontend): render region sub-rows and log markers on the timeline"
```

---

## Self-Review Notes

- **Spec coverage:** Parser region(depth stack)/log handling (spec §2) → Task 2; model types (spec §2) → Task 1. Variable-height lanes + region sub-rows + log markers (spec §3) → Tasks 4, 7. Region/log hit-testing + tooltips (spec §3 interaction) → Tasks 5, 6, 7. Frontend mirror → Task 3. Testing strategy (spec §4) → invariant Go test (Task 2) + pure Vitest (Tasks 4–6) + visual (Task 7).
- **Deferred to B4-2:** tasks (top track) + graph static task clusters.
- **Type consistency:** `model.Region`/`model.Log` (Go) mirror `Region`/`Log` (types.ts). `Lane` gains `totalHeight`/`regions`/`logs` and keeps `height` as the state-row height. `hitTimeline(lanes, x, y, regionRowH)` returns the discriminated `TimelineHit`; `TimelineCanvas` consumes all three kinds. `regionRowH`/`REGION_ROW_H`, `GUTTER_W`, `LANE_H` used consistently.
- **Transient break is intentional and documented:** Tasks 4–5 change `Lane`/`hitTimeline`; `npm run check` fails on `TimelineCanvas.svelte` until Task 7. Tasks 3–6 validate via `npm test`. The plan calls this out so an implementer doesn't treat it as a regression.
- **Invariant preserved:** graph, store, playback, filter untouched; parser changes are additive (annotation-free traces render exactly as before since `Regions`/`Logs` stay empty and `totalHeight == laneHeight`).
