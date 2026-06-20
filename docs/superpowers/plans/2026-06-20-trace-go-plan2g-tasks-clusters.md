# trace-go Plan 2G — Tasks Track + Graph Clusters (B4-2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse `runtime/trace` **tasks** (cross-goroutine logical spans) and render them as a timeline top track (nested by parent) and as static graph clusters (goroutines grouped by task, drawn inside labeled convex hulls).

**Architecture:** The Go parser gains task begin/end handling and records each region/log's task id; the model gains `Task` + `Region.Task`/`Log.Task`. The frontend computes everything pure: `layoutTaskTrack` (task bars + track height), a `topOffset` in `layoutTimeline`, `clusterByTask` (goroutine→task, once) + `convexHull`. The graph's cluster membership is computed only on node-set rebuild (never on playhead), so the "no re-jitter on time change" invariant holds. Store/playback/filter/flash are untouched.

**Tech Stack:** Go 1.26 (`golang.org/x/exp/trace`), Svelte 3 + TypeScript + Vite, Vitest, d3-force, Canvas 2D.

**Spec:** `docs/superpowers/specs/2026-06-20-tasks-clusters-design.md`. This is B4-2; B4-1 (regions+logs) is merged. Carried-over decisions: tasks = top track (nested by parent); graph = **static** clusters (membership computed once → no jitter, playhead only recolors); goroutine→task = its first task-bearing region's task.

---

## File Structure

- `internal/model/model.go` — **modify**: `Task` type + `TraceSummary.Tasks`; `Region.Task`, `Log.Task`.
- `internal/parse/parse.go` — **modify**: `EventTaskBegin/End` handling; record `ev.Region().Task`/`ev.Log().Task`.
- `internal/parse/testutil_test.go` / `parse_test.go` — **modify**: a task scenario + invariant test.
- `frontend/src/lib/types.ts` — **modify**: `Task` mirror + `region.task`/`log.task`/`summary.tasks`.
- `frontend/src/lib/taskTrack.ts` — **new**: `layoutTaskTrack`.
- `frontend/src/lib/timelineLayout.ts` — **modify**: `topOffset` option.
- `frontend/src/lib/graphCluster.ts` — **new**: `clusterByTask` + `convexHull`.
- `frontend/src/lib/format.ts` — **modify**: `taskColor`.
- `frontend/src/lib/tooltip.ts` — **modify**: `taskTooltip`.
- `frontend/src/lib/graphModel.ts` — **modify**: `GraphNode.cluster?`.
- `frontend/src/components/TimelineCanvas.svelte` — **modify**: draw top track + topOffset + task hover.
- `frontend/src/components/GraphCanvas.svelte` — **modify**: cluster assignment + cluster force + hull rendering.

**Note:** Tasks 5 & 10 change `LayoutOptions`/`GraphNode` shapes additively (new optional fields), so components keep type-checking between rounds. No transient break this time.

---

## Task 1: Model — Task type + region/log task id

**Files:** Modify `internal/model/model.go`; Test `internal/model/model_test.go`.

- [ ] **Step 1: Write the failing test (append to model_test.go)**

```go
func TestTaskJSON(t *testing.T) {
	sum := TraceSummary{
		Tasks: []Task{{ID: 5, Parent: 1, Name: "request", Start: 10, End: 90}},
		Goroutines: []Goroutine{{ID: 1, Regions: []Region{{Name: "r", Task: 5}}}},
		Logs:       []Log{{Time: 20, GoID: 1, Category: "c", Message: "m", Task: 5}},
	}
	b, err := json.Marshal(sum)
	if err != nil {
		t.Fatal(err)
	}
	var out TraceSummary
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	if out.Tasks[0].Name != "request" || out.Tasks[0].Parent != 1 {
		t.Fatalf("task round trip: %+v", out.Tasks)
	}
	if out.Goroutines[0].Regions[0].Task != 5 || out.Logs[0].Task != 5 {
		t.Fatalf("task id link lost: %+v / %+v", out.Goroutines[0].Regions, out.Logs)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go
go test ./internal/model/ -run TestTaskJSON
```
Expected: FAIL — `Task` undefined, `Region.Task`/`Log.Task`/`TraceSummary.Tasks` missing.

- [ ] **Step 3: Add the type and fields**

In `internal/model/model.go`:

Add the `Task` type (after the `Log` type):
```go
// Task is a runtime/trace.NewTask logical operation: a time span that may cross
// goroutines and nest under a parent task.
type Task struct {
	ID     uint64 `json:"id"`
	Parent uint64 `json:"parent"`
	Name   string `json:"name"`
	Start  Time   `json:"start"`
	End    Time   `json:"end"`
}
```
Add `Task` to the `Region` struct (after `Depth`):
```go
	Task uint64 `json:"task"` // owning task id (0 = none/background)
```
Add `Task` to the `Log` struct (after `Message`):
```go
	Task uint64 `json:"task"`
```
Add `Tasks` to the `TraceSummary` struct (after `Logs`):
```go
	Tasks []Task `json:"tasks,omitempty"`
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
git commit -m "feat(model): add Task type and region/log task ids"
```

---

## Task 2: Parser — tasks and region/log task linkage

**Files:** Modify `internal/parse/parse.go`, `internal/parse/testutil_test.go`, `internal/parse/parse_test.go`.

- [ ] **Step 1: Add a task scenario (testutil)**

In `internal/parse/testutil_test.go`, add (uses the already-imported `context`/`trace`):
```go
// scenarioTasks emits a parent task with a nested child task, each wrapping a
// region, so the parse output has tasks + region->task links.
func scenarioTasks() {
	ctx := context.Background()
	ctx, parent := trace.NewTask(ctx, "request")
	trace.WithRegion(ctx, "handle", func() {
		cctx, child := trace.NewTask(ctx, "db-batch")
		trace.WithRegion(cctx, "db-query", func() {})
		child.End()
	})
	parent.End()
}
```

- [ ] **Step 2: Write the failing test (append to parse_test.go)**

```go
func TestParseTasks(t *testing.T) {
	r := genTrace(t, scenarioTasks)
	sum, err := parse.Parse(r)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	var parent, child *model.Task
	for ti := range sum.Tasks {
		switch sum.Tasks[ti].Name {
		case "request":
			parent = &sum.Tasks[ti]
		case "db-batch":
			child = &sum.Tasks[ti]
		}
	}
	if parent == nil || child == nil {
		t.Fatalf("expected 'request' and 'db-batch' tasks, got %+v", sum.Tasks)
	}
	if child.Parent != parent.ID {
		t.Fatalf("child.Parent=%d, want %d", child.Parent, parent.ID)
	}
	if parent.End < parent.Start {
		t.Fatalf("task end before start: %+v", parent)
	}
	// At least one region must be linked to a task.
	linked := false
	for _, g := range sum.Goroutines {
		for _, reg := range g.Regions {
			if reg.Task != 0 {
				linked = true
			}
		}
	}
	if !linked {
		t.Fatal("expected at least one region linked to a task")
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go
go test ./internal/parse/ -run TestParseTasks
```
Expected: FAIL — tasks not parsed, region.Task always 0.

- [ ] **Step 4: Implement task handling**

In `internal/parse/parse.go`:

(a) Add a `task` field to the `openRegion` type:
```go
type openRegion struct {
	name  string
	start model.Time
	depth int
	task  uint64
}
```

(b) Declare a tasks map next to `var logs []model.Log`:
```go
	tasks := map[uint64]*model.Task{}
```

(c) In the event switch, set the region's task on begin, the log's task, and handle task events. Replace the `EventRegionBegin` case's push and the `EventLog` case, and add two task cases:
```go
		case exptrace.EventRegionBegin:
			gid := int64(ev.Goroutine())
			if gid != int64(exptrace.NoGoroutine) {
				b := get(gid)
				b.regionStack = append(b.regionStack, openRegion{
					name:  ev.Region().Type,
					start: now,
					depth: len(b.regionStack),
					task:  uint64(ev.Region().Task),
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
						Start: reg.start, End: now, Name: reg.name, Depth: reg.depth, Task: reg.task,
					})
				}
			}
			continue
		case exptrace.EventLog:
			// A log without a goroutine context keeps GoID == NoGoroutine; the
			// frontend groups logs by GoID, so it simply won't attach to a lane.
			lg := ev.Log()
			logs = append(logs, model.Log{
				Time: now, GoID: int64(ev.Goroutine()), Category: lg.Category, Message: lg.Message, Task: uint64(lg.Task),
			})
			continue
		case exptrace.EventTaskBegin:
			tk := ev.Task()
			t := tasks[uint64(tk.ID)]
			if t == nil {
				t = &model.Task{ID: uint64(tk.ID)}
				tasks[uint64(tk.ID)] = t
			}
			t.Parent = uint64(tk.Parent)
			t.Name = tk.Type
			t.Start = now
			continue
		case exptrace.EventTaskEnd:
			tk := ev.Task()
			t := tasks[uint64(tk.ID)]
			if t == nil {
				t = &model.Task{ID: uint64(tk.ID), Parent: uint64(tk.Parent), Name: tk.Type, Start: minT}
				tasks[uint64(tk.ID)] = t
			}
			t.End = now
			continue
```
(The `EventRegionBegin`/`EventRegionEnd`/`EventLog` cases above replace the existing ones; the two `EventTask*` cases are new.)

(d) Build the sorted `Tasks` slice and attach it. Just before the final `return`, after the logs sort, add:
```go
	taskList := make([]model.Task, 0, len(tasks))
	for _, t := range tasks {
		if t.End == 0 {
			t.End = maxT // unended task: extend to trace end
		}
		taskList = append(taskList, *t)
	}
	sort.Slice(taskList, func(i, j int) bool { return taskList[i].Start < taskList[j].Start })
```
and add `Tasks: taskList,` to the returned `&model.TraceSummary{...}`.

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
cd /Users/user/GolandProjects/trace-go
go test ./internal/parse/ -run TestParseTasks -v
go test ./internal/...
```
Expected: the new test PASSES; all existing parse/model tests still pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add internal/parse/
git commit -m "feat(parse): parse tasks and link regions/logs to their task"
```

---

## Task 3: Frontend types mirror

**Files:** Modify `frontend/src/lib/types.ts`.

- [ ] **Step 1: Add the types/fields**

In `frontend/src/lib/types.ts`:
- Add `task?: number` to the `Region` interface and to the `Log` interface.
- Add a `Task` interface:
```ts
export interface Task {
  id: number
  parent: number
  name: string
  start: number
  end: number
}
```
- Add `tasks?: Task[]` to the `TraceSummary` interface.

- [ ] **Step 2: Verify the suite still passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test
```
Expected: all existing unit suites pass (pure type addition).

- [ ] **Step 3: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/types.ts
git commit -m "feat(frontend): mirror Task type and region/log task ids"
```

---

## Task 4: Pure task-track layout

**Files:** Create `frontend/src/lib/taskTrack.ts`; Test `frontend/src/lib/taskTrack.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/taskTrack.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- taskTrack
```
Expected: FAIL — cannot find `./taskTrack`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/taskTrack.ts`:
```ts
import { makeTimeScale } from './timeMap'
import type { Task } from './types'

export interface TaskBar {
  id: number
  x: number
  width: number
  depth: number
  name: string
  start: number
  end: number
}

export interface TaskTrack {
  bars: TaskBar[]
  height: number
}

export interface TaskTrackOptions {
  width: number
  gutter: number
  startTime: number
  endTime: number
  taskRowH: number
}

// layoutTaskTrack maps each task to a bar (x/width over the gutter-offset time
// axis) and a depth equal to its parent-chain length, plus the total track
// height ((maxDepth+1) * taskRowH, or 0 when there are no tasks).
export function layoutTaskTrack(tasks: Task[], opts: TaskTrackOptions): TaskTrack {
  if (tasks.length === 0) return { bars: [], height: 0 }
  const byId = new Map<number, Task>(tasks.map((t) => [t.id, t]))
  const depthCache = new Map<number, number>()
  const depthOf = (t: Task): number => {
    if (depthCache.has(t.id)) return depthCache.get(t.id)!
    const parent = byId.get(t.parent)
    const d = parent ? depthOf(parent) + 1 : 0
    depthCache.set(t.id, d)
    return d
  }

  const scale = makeTimeScale(opts.startTime, opts.endTime, opts.gutter, opts.width)
  let maxDepth = 0
  const bars: TaskBar[] = tasks.map((t) => {
    const depth = depthOf(t)
    if (depth > maxDepth) maxDepth = depth
    const x = scale.toPixel(t.start)
    return { id: t.id, x, width: Math.max(1, scale.toPixel(t.end) - x), depth, name: t.name, start: t.start, end: t.end }
  })
  return { bars, height: (maxDepth + 1) * opts.taskRowH }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- taskTrack
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/taskTrack.ts frontend/src/lib/taskTrack.test.ts
git commit -m "feat(frontend): pure task-track layout"
```

---

## Task 5: timelineLayout topOffset

**Files:** Modify `frontend/src/lib/timelineLayout.ts`; Test `frontend/src/lib/timelineLayout.test.ts`.

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('layoutTimeline topOffset', () => {
  const summary = {
    startTime: 0, endTime: 100,
    goroutines: [{ id: 1, name: 'a', createdAt: 0, endedAt: 100, intervals: [{ start: 0, end: 100, state: 'running', blockReason: '' }] }],
    edges: [],
  } as any

  it('starts the first lane below the top offset', () => {
    const lanes = layoutTimeline(summary, { width: 200, laneHeight: 18, laneGap: 4, topOffset: 30 })
    expect(lanes[0].y).toBe(30)
  })
  it('defaults to no offset', () => {
    const lanes = layoutTimeline(summary, { width: 200, laneHeight: 18, laneGap: 4 })
    expect(lanes[0].y).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- timelineLayout
```
Expected: FAIL — first assertion expects y=30, gets 0.

- [ ] **Step 3: Implement**

In `frontend/src/lib/timelineLayout.ts`, add `topOffset?: number` to `LayoutOptions`:
```ts
  topOffset?: number // reserved space above the first lane (e.g. a task track)
```
and change the initial `let y = 0` in `layoutTimeline` to:
```ts
  let y = opts.topOffset ?? 0
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- timelineLayout
```
Expected: all timelineLayout tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/timelineLayout.ts frontend/src/lib/timelineLayout.test.ts
git commit -m "feat(frontend): add topOffset to timeline layout"
```

---

## Task 6: Pure cluster assignment + convex hull

**Files:** Create `frontend/src/lib/graphCluster.ts`; Test `frontend/src/lib/graphCluster.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/graphCluster.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { clusterByTask, convexHull } from './graphCluster'
import type { Goroutine } from './types'

describe('clusterByTask', () => {
  const goroutines: Goroutine[] = [
    { id: 1, name: 'a', createdAt: 0, endedAt: 0, intervals: [], regions: [{ start: 0, end: 9, name: 'r', depth: 0, task: 5 }] },
    { id: 2, name: 'b', createdAt: 0, endedAt: 0, intervals: [], regions: [{ start: 0, end: 9, name: 'r', depth: 0, task: 9 }] },
    { id: 3, name: 'c', createdAt: 0, endedAt: 0, intervals: [], regions: [] }, // no task region
  ]
  it('assigns each goroutine to its first known-task region', () => {
    const m = clusterByTask(goroutines, new Set([5, 9]))
    expect(m.get(1)).toBe(5)
    expect(m.get(2)).toBe(9)
    expect(m.has(3)).toBe(false)
  })
  it('ignores regions whose task is not a known task', () => {
    const m = clusterByTask(goroutines, new Set([5])) // 9 not known
    expect(m.get(1)).toBe(5)
    expect(m.has(2)).toBe(false)
  })
})

describe('convexHull', () => {
  it('returns the boundary of a point set', () => {
    const hull = convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]])
    // interior point (5,5) excluded; 4 corners remain
    expect(hull).toHaveLength(4)
  })
  it('passes through <3 points unchanged', () => {
    expect(convexHull([[1, 2], [3, 4]])).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- graphCluster
```
Expected: FAIL — cannot find `./graphCluster`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/graphCluster.ts`:
```ts
import type { Goroutine } from './types'

// clusterByTask assigns each goroutine to a task (its first region whose task is
// in knownTaskIds). Goroutines with no such region are left unassigned. Membership
// is time-independent, so the graph can cluster once and never re-layout on time.
export function clusterByTask(goroutines: Goroutine[], knownTaskIds: Set<number>): Map<number, number> {
  const out = new Map<number, number>()
  for (const g of goroutines) {
    const reg = (g.regions ?? []).find((r) => r.task != null && knownTaskIds.has(r.task))
    if (reg) out.set(g.id, reg.task as number)
  }
  return out
}

// convexHull returns the convex boundary (counter-clockwise) of a set of points
// via Andrew's monotone chain. Fewer than 3 points are returned unchanged.
export function convexHull(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points.slice()
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- graphCluster
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/graphCluster.ts frontend/src/lib/graphCluster.test.ts
git commit -m "feat(frontend): add task clustering and convex hull"
```

---

## Task 7: taskColor + taskTooltip

**Files:** Modify `frontend/src/lib/format.ts`, `frontend/src/lib/tooltip.ts`; Tests: their `.test.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/lib/format.test.ts`:
```ts
import { taskColor } from './format'

describe('taskColor', () => {
  it('is deterministic per id and cycles a palette', () => {
    expect(taskColor(5)).toBe(taskColor(5))
    expect(typeof taskColor(0)).toBe('string')
  })
})
```
Append to `frontend/src/lib/tooltip.test.ts`:
```ts
import { taskTooltip } from './tooltip'

describe('taskTooltip', () => {
  it('shows the task name and duration in ms', () => {
    expect(taskTooltip('request', 0, 2_000_000)).toBe('request\n2.000 ms')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- "format|tooltip"
```
Expected: FAIL — `taskColor`/`taskTooltip` not exported.

- [ ] **Step 3: Implement**

Append to `frontend/src/lib/format.ts`:
```ts
// Distinct task colors, indexed by task id (stable across redraws).
const TASK_PALETTE = ['#7a6bb0', '#5b8def', '#3a8a63', '#c08457', '#b05a8a', '#4aa3a3']

export function taskColor(id: number): string {
  return TASK_PALETTE[id % TASK_PALETTE.length]
}
```
Append to `frontend/src/lib/tooltip.ts`:
```ts
// taskTooltip shows a hovered task's name and its duration (ms, 3 decimals).
export function taskTooltip(name: string, start: number, end: number): string {
  return `${name}\n${((end - start) / 1e6).toFixed(3)} ms`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- "format|tooltip"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/format.ts frontend/src/lib/format.test.ts frontend/src/lib/tooltip.ts frontend/src/lib/tooltip.test.ts
git commit -m "feat(frontend): add task color palette and task tooltip"
```

---

## Task 8: GraphNode cluster field

**Files:** Modify `frontend/src/lib/graphModel.ts`.

- [ ] **Step 1: Add the optional field**

In `frontend/src/lib/graphModel.ts`, add to the `GraphNode` interface (after `vy?`):
```ts
  cluster?: number // task id this node is statically grouped under (set by the view)
```

- [ ] **Step 2: Verify the suite still passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- graphModel
```
Expected: graphModel tests still pass (optional field, no behavior change).

- [ ] **Step 3: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/graphModel.ts
git commit -m "feat(frontend): add cluster field to graph node"
```

---

## Task 9: TimelineCanvas top track (manual-verified)

Adds the task track above the lanes. The lib changes above keep the component type-checking; this adds the rendering + hover.

**Files:** Modify `frontend/src/components/TimelineCanvas.svelte`.

- [ ] **Step 1: Imports + constants + track layout**

In `frontend/src/components/TimelineCanvas.svelte`:

(a) Replace the import on line 4-8 region to add the new modules — change the imports block to:
```svelte
  import { onMount } from 'svelte'
  import { traceStore } from '../stores/trace'
  import { layoutTimeline, type Lane } from '../lib/timelineLayout'
  import { layoutTaskTrack, type TaskBar } from '../lib/taskTrack'
  import { makeTimeScale } from '../lib/timeMap'
  import { visibleGoroutines } from '../lib/filter'
  import { hitTimeline } from '../lib/hit'
  import { intervalTooltip, regionTooltip, logTooltip, taskTooltip } from '../lib/tooltip'
  import { taskColor } from '../lib/format'
```

(b) Add a constant near the others (after `LOG_COLOR`):
```svelte
  const TASK_ROW_H = 14
```

(c) Add a reactive task-track and feed `topOffset` to the layout. Replace the `$: lanes = ...` block (lines 26-34) with:
```svelte
  $: taskTrack = $summary
    ? layoutTaskTrack($summary.tasks ?? [], {
        width: cssWidth, gutter: GUTTER_W, startTime: $summary.startTime, endTime: $summary.endTime, taskRowH: TASK_ROW_H,
      })
    : { bars: [] as TaskBar[], height: 0 }
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
And add `taskTrack` to the redraw trigger — change line 36 to:
```svelte
  $: void [$playhead, lanes, cssWidth, cssHeight, $selectedId, taskTrack], draw()
```

- [ ] **Step 2: Draw the task track**

In `draw()`, right after the background fill (`ctx.fillRect(0, 0, cssWidth, cssHeight)`), insert:
```svelte
    // Task track (top): bars by parent depth + a gutter label.
    if (taskTrack.bars.length) {
      ctx.font = '9px system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      for (const bar of taskTrack.bars) {
        const by = bar.depth * TASK_ROW_H
        ctx.fillStyle = taskColor(bar.id)
        ctx.fillRect(bar.x, by + 1, bar.width, TASK_ROW_H - 2)
        if (bar.width > 16) {
          ctx.fillStyle = '#0f1117'
          ctx.fillText(fitLabel(ctx, bar.name, bar.width - 4), bar.x + 3, by + TASK_ROW_H / 2)
        }
      }
      ctx.fillStyle = '#8a93a3'
      ctx.font = '10px system-ui, sans-serif'
      ctx.fillText('TASKS', 4, TASK_ROW_H / 2)
    }
```

- [ ] **Step 3: Task hover**

In `onPointerMove`, before the existing `const h = hitTimeline(...)` line, insert a task-track check:
```svelte
    if (taskTrack.bars.length && y < taskTrack.height) {
      const depth = Math.floor(y / TASK_ROW_H)
      const bar = taskTrack.bars.find((b) => b.depth === depth && x >= b.x && x < b.x + b.width)
      tip = bar ? { text: taskTooltip(bar.name, bar.start, bar.end), x, y } : null
      return
    }
```

- [ ] **Step 4: Type-check, test, build**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm run check && npm test
cd /Users/user/GolandProjects/trace-go
wails build
```
Expected: 0 check errors; all unit suites pass; `wails build` succeeds.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/components/TimelineCanvas.svelte
git commit -m "feat(frontend): render the timeline task track"
```

---

## Task 10: GraphCanvas static clusters + hulls (manual-verified)

Assigns each node a static cluster, adds a per-cluster attraction force (applied only on rebuild), and draws labeled hulls under the graph. Comets/state colors/no-jitter all preserved.

**Files:** Modify `frontend/src/components/GraphCanvas.svelte`.

- [ ] **Step 1: Imports**

In `frontend/src/components/GraphCanvas.svelte`, add `forceX, forceY` to the d3-force import and the new lib imports:
```svelte
  import {
    forceSimulation,
    forceManyBody,
    forceLink,
    forceCenter,
    forceCollide,
    forceX,
    forceY,
    type Simulation,
  } from 'd3-force'
```
and after the existing `import { nodeTooltip, edgeTooltip } from '../lib/tooltip'` line add:
```svelte
  import { clusterByTask, convexHull } from '../lib/graphCluster'
  import { taskColor } from '../lib/format'
```
Also add `taskColor` to the existing `../lib/format` import instead if you prefer one import; either compiles.

- [ ] **Step 2: Cluster state + assignment in rebuild**

Add cluster state near the other `let` declarations (after `let nodeById = ...`):
```svelte
  let clusterSeeds = new Map<number, { x: number; y: number }>()
```
In `rebuild(...)`, after `nodeById = new Map(...)`, insert the cluster assignment + seeds:
```svelte
    const known = new Set(($summary?.tasks ?? []).map((t) => t.id))
    const clusters = clusterByTask(goroutines, known)
    for (const n of nodes) n.cluster = clusters.get(n.id)
    const clusterIds = [...new Set([...clusters.values()])]
    clusterSeeds = new Map()
    clusterIds.forEach((cid, i) => {
      const ang = clusterIds.length ? (i / clusterIds.length) * Math.PI * 2 : 0
      clusterSeeds.set(cid, { x: cssWidth / 2 + Math.cos(ang) * cssWidth * 0.28, y: cssHeight / 2 + Math.sin(ang) * cssHeight * 0.28 })
    })
```
Then add two forces to the `sim = forceSimulation(...)` chain (after `.force('collide', forceCollide(16))`):
```svelte
      .force('cx', forceX<GraphNode>((n) => (n.cluster != null ? clusterSeeds.get(n.cluster)!.x : cssWidth / 2)).strength((n) => (n.cluster != null ? 0.2 : 0.03)))
      .force('cy', forceY<GraphNode>((n) => (n.cluster != null ? clusterSeeds.get(n.cluster)!.y : cssHeight / 2)).strength((n) => (n.cluster != null ? 0.2 : 0.03)))
```

- [ ] **Step 3: Draw hulls (under the edges)**

In `draw()`, immediately after `ctx.fillRect(0, 0, cssWidth, cssHeight)` and BEFORE the edges loop, insert:
```svelte
    // Static task-cluster hulls (background layer).
    const byCluster = new Map<number, GraphNode[]>()
    for (const n of nodes) {
      if (n.cluster == null || n.x == null) continue
      const arr = byCluster.get(n.cluster)
      if (arr) arr.push(n)
      else byCluster.set(n.cluster, [n])
    }
    const taskName = new Map<number, string>(($summary?.tasks ?? []).map((t) => [t.id, t.name]))
    for (const [cid, members] of byCluster) {
      const pts = members.map((n) => [n.x!, n.y!] as [number, number])
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
      const padded = pts.map(([px, py]) => {
        const dx = px - cx
        const dy = py - cy
        const len = Math.hypot(dx, dy) || 1
        return [px + (dx / len) * 22, py + (dy / len) * 22] as [number, number]
      })
      const hull = convexHull(padded)
      if (hull.length >= 3) {
        ctx.beginPath()
        ctx.moveTo(hull[0][0], hull[0][1])
        for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i][0], hull[i][1])
        ctx.closePath()
        ctx.fillStyle = taskColor(cid) + '22'
        ctx.fill()
        ctx.strokeStyle = taskColor(cid)
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      ctx.fillStyle = taskColor(cid)
      ctx.font = '10px system-ui, sans-serif'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(taskName.get(cid) ?? `task ${cid}`, cx - 20, cy - 24)
    }
```

- [ ] **Step 4: Type-check, test, build**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm run check && npm test
cd /Users/user/GolandProjects/trace-go
wails build
```
Expected: 0 check errors; all unit suites pass; `wails build` succeeds.

- [ ] **Step 5: Manual visual verification (human)**

Generate a task-annotated trace and open it. Run:
```bash
mkdir -p /tmp/tgt && cat > /tmp/tgt/main.go <<'GO'
package main

import (
	"context"
	"os"
	"runtime/trace"
	"sync"
	"time"
)

func main() {
	f, _ := os.Create("/tmp/tgt/trace.out")
	trace.Start(f)
	defer func() { trace.Stop(); f.Close() }()
	ctx := context.Background()
	var wg sync.WaitGroup
	for r := 0; r < 2; r++ {
		ctx2, task := trace.NewTask(ctx, "request")
		for i := 0; i < 3; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				trace.WithRegion(ctx2, "handle", func() { time.Sleep(time.Millisecond) })
			}()
		}
		wg.Wait()
		task.End()
	}
}
GO
( cd /tmp/tgt && go run main.go ) && cp /tmp/tgt/trace.out ~/Desktop/trace-tasks.out && echo "ready: ~/Desktop/trace-tasks.out"
```
Then open `~/Desktop/trace-tasks.out` and confirm:
1. A **TASKS track** sits above the goroutine lanes with `request` task bars; hovering one shows name + duration.
2. In the **graph**, goroutines that ran a task's regions are grouped inside a **labeled colored hull**; hull color matches the task track.
3. **Playing/scrubbing recolors nodes but the hulls/clusters do NOT move or re-jitter** (the key invariant). Comets still flash.
4. The timeline lanes are pushed down by the track and the playhead/scrub/gutter labels still line up.

Report observations. If `wails dev` can't launch, report DONE_WITH_CONCERNS noting build + type-check + unit tests passed and only the live check remains.

- [ ] **Step 6: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/components/GraphCanvas.svelte
git commit -m "feat(frontend): static task clusters with hulls on the graph"
```

---

## Self-Review Notes

- **Spec coverage:** Parser tasks + region/log task ids (spec §2) → Tasks 1–2; timeline top track (spec §3) → Tasks 4, 5, 9; graph static clusters + hulls (spec §4) → Tasks 6, 8, 10; task color/tooltip → Task 7.
- **Invariant preserved:** cluster membership (`clusterByTask`) and seeds are computed only in `rebuild` (node-set change), and the cluster forces are added to the sim there — never on `$playhead`. `draw()` recomputes hull geometry each frame from current node positions, but membership/positions don't change with time, so no re-jitter. State colors + comets unchanged.
- **No transient break:** Tasks 5/8 add optional fields (`topOffset`, `cluster`), so components keep type-checking across rounds.
- **Type consistency:** `model.Task`/`Region.Task`/`Log.Task` (Go) mirror `Task`/`region.task`/`log.task` (types.ts). `layoutTaskTrack`→`TaskBar`/`TaskTrack`, `clusterByTask`/`convexHull`, `taskColor`/`taskTooltip`, `GraphNode.cluster`, `LayoutOptions.topOffset` used consistently. `TASK_ROW_H` shared between the layout (passed in) and the component drawing.
- **Backward compatible:** task-free traces yield empty `Tasks` → `taskTrack.height === 0` (no offset, timeline identical to B4-1) and no clusters (graph identical).
