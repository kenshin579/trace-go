# trace-go Plan 2A — Wails Shell + OpenTrace Binding + Timeline View

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Wails desktop app for `trace-go`, wire the existing Go parser to the frontend through an `OpenTrace` binding, and render an interactive goroutine **timeline** (lanes + state colors + draggable playhead/scrub) from a real trace file.

**Architecture:** A Wails v2 app (Go backend + Svelte 3/TypeScript frontend) layered on the existing pure-Go backend. The Go `App` exposes `OpenTrace(path)`/`OpenTraceDialog()` that call `internal/parse.Parse` and return the JSON-marshaled `model.TraceSummary`. The frontend keeps all view math in pure, unit-tested TypeScript modules (`lib/`), and thin Svelte components (`TimelineCanvas.svelte`) that only draw a precomputed layout to a `<canvas>`. A Svelte store holds the loaded summary, the playhead time, and the visible time viewport.

**Tech Stack:** Wails v2.11, Go 1.25+, Svelte 3 + TypeScript + Vite (the default `svelte-ts` template), Vitest for pure-logic unit tests, HTML Canvas 2D for rendering.

**Scope note:** This is Plan 2A of the `trace-go` v1 spec (`docs/superpowers/specs/2026-06-19-concurrency-visualizer-design.md`). It implements spec phase 0 (scaffold) and phase 3 (timeline + file open + scrub). The **live graph view, playback/animation, and timeline↔graph sync (spec §4 lower half, phases 4–5)** are **Plan 2B**, written after 2A proves the data contract renders correctly in a real window. Plan 1 (the parser) is already merged on `main`.

**Prerequisites verified on this machine:** `wails v2.11.0`, `node v25`, `npm 11`, `go 1.26`, `clang`. Module path is `github.com/kenshin579/trace-go`; `internal/parse.Parse(io.Reader) (*model.TraceSummary, error)` and `internal/model` already exist and are tested.

---

## Data contract (from Plan 1's final review — the frontend MUST honor these)

- `name` is often `""` (main goroutine and any goroutine alive at trace start). **Fall back to `g<id>`** in the UI.
- `endedAt == 0` is a sentinel meaning "never ended within the trace" — treat the lane as extending to `TraceSummary.endTime`.
- Times are large absolute nanosecond `number`s (well under 2^53, safe as JS numbers). **Normalize against `startTime`** for display.
- A `Blocked` interval may have an empty `blockReason` (omitted in JSON) — tooltip/UI must tolerate a missing reason.
- Expect many `runtime.*` system goroutines in every trace; that's fine for 2A (no filtering yet).

---

## File Structure

**Backend (Go, repo root — new):**
- `main.go` — Wails entrypoint (from template, unchanged except title).
- `app.go` — `App` struct; replaces template `Greet` with `OpenTrace` + `OpenTraceDialog`.
- `app_test.go` — Go test for `OpenTrace` against a generated trace file.
- `wails.json`, `build/` — Wails config/assets (from template).

**Frontend (`frontend/`, from template + new files under `frontend/src/`):**
- `lib/timeMap.ts` — pure linear time↔pixel scale. Test: `lib/timeMap.test.ts`.
- `lib/timelineLayout.ts` — pure `summary + viewport → lane draw-list`. Test: `lib/timelineLayout.test.ts`.
- `lib/format.ts` — pure helpers (`goroutineLabel`, `effectiveEnd`, `stateColor`). Test: `lib/format.test.ts`.
- `stores/trace.ts` — Svelte store: `summary`, `playhead`, `viewport`, plus actions (`loadSummary`, `setPlayhead`). Test: `stores/trace.test.ts`.
- `components/TimelineCanvas.svelte` — draws the layout; handles scrub drag + wheel zoom/pan (manual-verified).
- `App.svelte` — top bar (Open button + trace info) + `TimelineCanvas` (replaces template content).

**Why pure `lib/` modules:** Canvas pixels can't be meaningfully unit-tested, but the math that decides *what* to draw can. We TDD the scales/layout/state logic and keep components thin, so visual review is the only manual step.

---

## Task 0: Scaffold the Wails app into the existing repo

This is a setup task (not TDD). It merges a fresh `wails init` into the current module without disturbing `internal/`, `cmd/`, or the existing `go.mod` module path.

**Files:** Create `main.go`, `app.go`, `wails.json`, `build/`, `frontend/`; modify `.gitignore`, `go.mod`/`go.sum`.

- [ ] **Step 1: Generate a fresh Wails project in a temp dir**

Run:
```bash
TMP=$(mktemp -d)
( cd "$TMP" && wails init -n trace-go -t svelte-ts )
ls "$TMP/trace-go"
```
Expected: a `trace-go` dir containing `main.go`, `app.go`, `wails.json`, `build/`, `frontend/`, plus a throwaway `go.mod`/`go.sum`/`.gitignore`/`README.md`.

- [ ] **Step 2: Copy the Wails files into the repo (NOT its go.mod/go.sum/README/.gitignore)**

Run (repo root = `/Users/user/GolandProjects/trace-go`):
```bash
REPO=/Users/user/GolandProjects/trace-go
cp "$TMP/trace-go/main.go" "$TMP/trace-go/app.go" "$TMP/trace-go/wails.json" "$REPO/"
cp -R "$TMP/trace-go/build" "$REPO/build"
cp -R "$TMP/trace-go/frontend" "$REPO/frontend"
ls "$REPO"
```
Expected: repo now has `main.go`, `app.go`, `wails.json`, `build/`, `frontend/` alongside the existing `cmd/`, `internal/`, `docs/`, `go.mod`.

- [ ] **Step 3: Merge Wails ignore rules into the repo `.gitignore`**

Append to `/Users/user/GolandProjects/trace-go/.gitignore` (note the `gitkeep` exception so the embed target survives a clean checkout — the file is literally named `gitkeep`, no dot):
```gitignore

# Wails
build/bin
frontend/node_modules
frontend/dist/*
!frontend/dist/gitkeep
```

- [ ] **Step 4: Add the Wails dependency to the existing module and tidy**

Run:
```bash
cd /Users/user/GolandProjects/trace-go
go get github.com/wailsapp/wails/v2@v2.11.0
go mod tidy
head -3 go.mod
```
Expected: module line still `module github.com/kenshin579/trace-go`; `go.mod` now requires both `golang.org/x/exp` and `github.com/wailsapp/wails/v2`. (The `go` directive may be `1.25.0`+ — accepted, per Plan 1.)

- [ ] **Step 5: Set the window title in `main.go`**

In `main.go`, the `options.App` `Title` is already `"trace-go"`. Leave it. No edit needed unless it differs; if it does, set `Title: "trace-go"`.

- [ ] **Step 6: Verify the app builds (Go + frontend embed)**

Run:
```bash
cd /Users/user/GolandProjects/trace-go
go build ./...
go test ./internal/... ./cmd/...
```
Expected: `go build ./...` succeeds (the root `main` package compiles; `//go:embed all:frontend/dist` is satisfied by `frontend/dist/gitkeep`). The existing parser/CLI tests still pass.

- [ ] **Step 7: Verify the desktop app compiles end-to-end**

Run (this installs npm deps and builds the production bundle + binary; it can take a few minutes the first time):
```bash
cd /Users/user/GolandProjects/trace-go
wails build
ls build/bin
```
Expected: `wails build` completes without error and produces an app bundle/binary under `build/bin`. If `wails build` fails on the frontend step, run `cd frontend && npm install` first, then retry. **If `wails build` cannot run in this environment (e.g. missing system webview libs), report it as DONE_WITH_CONCERNS — the Go side still building via Step 6 is the hard gate; the GUI binary can be verified by the human.**

- [ ] **Step 8: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add -A
git commit -m "chore: scaffold wails v2 svelte-ts app into module"
```

---

## Task 1: `OpenTrace` Go binding (replaces template `Greet`)

**Files:** Modify `app.go`; Create `app_test.go`.

- [ ] **Step 1: Write the failing test**

Create `app_test.go`:
```go
package main

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime/trace"
	"sync"
	"testing"
)

// writeSampleTrace runs an unbuffered send/recv rendezvous under the tracer and
// writes the trace to a temp file, returning its path.
func writeSampleTrace(t *testing.T) string {
	t.Helper()
	var buf bytes.Buffer
	if err := trace.Start(&buf); err != nil {
		t.Fatalf("trace.Start: %v", err)
	}
	ch := make(chan int)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); ch <- 1 }()
	go func() { defer wg.Done(); <-ch }()
	wg.Wait()
	trace.Stop()

	path := filepath.Join(t.TempDir(), "trace.out")
	if err := os.WriteFile(path, buf.Bytes(), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	return path
}

func TestOpenTraceReturnsSummary(t *testing.T) {
	app := NewApp()
	sum, err := app.OpenTrace(writeSampleTrace(t))
	if err != nil {
		t.Fatalf("OpenTrace: %v", err)
	}
	if sum == nil || len(sum.Goroutines) == 0 {
		t.Fatalf("expected a non-empty summary, got %+v", sum)
	}
	if sum.EndTime <= sum.StartTime {
		t.Fatalf("bad time range: %d..%d", sum.StartTime, sum.EndTime)
	}
}

func TestOpenTraceMissingFileErrors(t *testing.T) {
	app := NewApp()
	if _, err := app.OpenTrace("/no/such/trace.out"); err == nil {
		t.Fatal("expected an error opening a missing file")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go
go test . -run TestOpenTrace
```
Expected: FAIL — `app.OpenTrace undefined` (only `Greet` exists).

- [ ] **Step 3: Replace `Greet` with the binding methods**

Edit `app.go` to this exact content:
```go
package main

import (
	"context"
	"os"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/kenshin579/trace-go/internal/model"
	"github.com/kenshin579/trace-go/internal/parse"
)

// App is the Wails-bound application backend.
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct.
func NewApp() *App {
	return &App{}
}

// startup stores the Wails runtime context for later runtime calls (dialogs).
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// OpenTrace parses the execution trace at path into a rendering-ready summary.
func (a *App) OpenTrace(path string) (*model.TraceSummary, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return parse.Parse(f)
}

// OpenTraceDialog shows a native file picker and parses the chosen trace.
// It returns (nil, nil) when the user cancels the dialog.
func (a *App) OpenTraceDialog() (*model.TraceSummary, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open Go execution trace",
		Filters: []runtime.FileFilter{
			{DisplayName: "Trace files (*.out, *.trace)", Pattern: "*.out;*.trace"},
			{DisplayName: "All files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil // user cancelled
	}
	return a.OpenTrace(path)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go
go test . -run TestOpenTrace -v
```
Expected: both tests PASS.

- [ ] **Step 5: Regenerate the TypeScript bindings**

Run:
```bash
cd /Users/user/GolandProjects/trace-go
wails generate module
cat frontend/wailsjs/go/main/App.d.ts
```
Expected: `App.d.ts` now declares `OpenTrace(arg1:string): Promise<model.TraceSummary>` and `OpenTraceDialog(): Promise<model.TraceSummary>`, and a `frontend/wailsjs/go/models.ts` now exists describing `model.TraceSummary`/`Goroutine`/`Interval`/`CausalEdge`. (If `wails generate module` is unavailable, `wails build`/`wails dev` regenerate these as a side effect.)

- [ ] **Step 6: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add app.go app_test.go frontend/wailsjs
git commit -m "feat(app): expose OpenTrace/OpenTraceDialog bindings"
```

---

## Task 2: Frontend test tooling (Vitest)

**Files:** Modify `frontend/package.json`; Create `frontend/vitest.config.ts`.

- [ ] **Step 1: Add Vitest as a dev dependency**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm install -D vitest@^1.6.0
```
Expected: `vitest` added under `devDependencies` in `frontend/package.json`.

- [ ] **Step 2: Add a `test` script**

In `frontend/package.json`, add to the `"scripts"` object:
```json
    "test": "vitest run"
```
(Keep the existing `dev`/`build`/`preview`/`check` scripts.)

- [ ] **Step 3: Create the Vitest config**

Create `frontend/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: Verify the runner works with a trivial smoke test**

Create `frontend/src/lib/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('vitest', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```
Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test
```
Expected: 1 passing test.

- [ ] **Step 5: Remove the smoke test and commit**

```bash
cd /Users/user/GolandProjects/trace-go/frontend
rm src/lib/smoke.test.ts
cd /Users/user/GolandProjects/trace-go
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts
git commit -m "test(frontend): add vitest runner"
```

---

## Task 3: Pure time↔pixel scale

**Files:** Create `frontend/src/lib/timeMap.ts`; Test `frontend/src/lib/timeMap.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/timeMap.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { makeTimeScale } from './timeMap'

describe('makeTimeScale', () => {
  it('maps the domain start to the range start and end to end', () => {
    const s = makeTimeScale(1000, 2000, 0, 500)
    expect(s.toPixel(1000)).toBe(0)
    expect(s.toPixel(2000)).toBe(500)
    expect(s.toPixel(1500)).toBe(250)
  })

  it('inverts pixels back to time', () => {
    const s = makeTimeScale(1000, 2000, 0, 500)
    expect(s.toTime(0)).toBe(1000)
    expect(s.toTime(500)).toBe(2000)
    expect(s.toTime(250)).toBe(1500)
  })

  it('is robust to a zero-width domain (degenerate trace)', () => {
    const s = makeTimeScale(1000, 1000, 0, 500)
    expect(Number.isFinite(s.toPixel(1000))).toBe(true)
    expect(Number.isFinite(s.toTime(250))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- timeMap
```
Expected: FAIL — cannot find `./timeMap`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/timeMap.ts`:
```ts
// A linear, invertible mapping between trace time (ns) and pixels.
export interface TimeScale {
  toPixel(time: number): number
  toTime(pixel: number): number
}

// makeTimeScale maps [domainStart, domainEnd] onto [rangeStart, rangeEnd].
// A zero-width domain collapses to rangeStart (no division by zero).
export function makeTimeScale(
  domainStart: number,
  domainEnd: number,
  rangeStart: number,
  rangeEnd: number,
): TimeScale {
  const domainSpan = domainEnd - domainStart
  const rangeSpan = rangeEnd - rangeStart
  const k = domainSpan === 0 ? 0 : rangeSpan / domainSpan
  return {
    toPixel: (time) => rangeStart + (time - domainStart) * k,
    toTime: (pixel) => (k === 0 ? domainStart : domainStart + (pixel - rangeStart) / k),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- timeMap
```
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/timeMap.ts frontend/src/lib/timeMap.test.ts
git commit -m "feat(frontend): add linear time-pixel scale"
```

---

## Task 4: Pure display helpers

**Files:** Create `frontend/src/lib/format.ts`; Test `frontend/src/lib/format.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { goroutineLabel, effectiveEnd, stateColor } from './format'

describe('goroutineLabel', () => {
  it('uses the name when present', () => {
    expect(goroutineLabel({ id: 7, name: 'main.worker' })).toBe('main.worker')
  })
  it('falls back to g<id> when the name is empty', () => {
    expect(goroutineLabel({ id: 7, name: '' })).toBe('g7')
  })
})

describe('effectiveEnd', () => {
  it('returns endedAt when the goroutine ended', () => {
    expect(effectiveEnd({ endedAt: 900 }, 1000)).toBe(900)
  })
  it('returns the trace end when endedAt is the 0 sentinel', () => {
    expect(effectiveEnd({ endedAt: 0 }, 1000)).toBe(1000)
  })
})

describe('stateColor', () => {
  it('maps known states to distinct colors and falls back for unknown', () => {
    const r = stateColor('running')
    const b = stateColor('blocked')
    const u = stateColor('runnable')
    expect(new Set([r, b, u]).size).toBe(3)
    expect(typeof stateColor('???' as any)).toBe('string')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- format
```
Expected: FAIL — cannot find `./format`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/format.ts`:
```ts
// Pure display helpers shared by the layout and the canvas renderer.

export function goroutineLabel(g: { id: number; name: string }): string {
  return g.name !== '' ? g.name : `g${g.id}`
}

// effectiveEnd resolves the 0 "never ended" sentinel to the trace end time.
export function effectiveEnd(g: { endedAt: number }, traceEnd: number): number {
  return g.endedAt === 0 ? traceEnd : g.endedAt
}

export type IntervalState = 'running' | 'runnable' | 'blocked'

const STATE_COLORS: Record<IntervalState, string> = {
  running: '#4caf50',
  runnable: '#9aa3b2',
  blocked: '#c25450',
}

// stateColor returns a fill for a known state, or a neutral gray for anything
// unexpected (defensive against future trace states).
export function stateColor(state: IntervalState): string {
  return STATE_COLORS[state] ?? '#5b6270'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- format
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/format.ts frontend/src/lib/format.test.ts
git commit -m "feat(frontend): add display helpers (label, effective end, state color)"
```

---

## Task 5: Pure timeline layout

Computes, for a viewport, the rectangles to draw per goroutine lane. This is the heart of the timeline and is fully unit-tested.

**Files:** Create `frontend/src/lib/timelineLayout.ts`; Test `frontend/src/lib/timelineLayout.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/timelineLayout.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { layoutTimeline } from './timelineLayout'
import type { TraceSummary } from './types'

const summary: TraceSummary = {
  startTime: 0,
  endTime: 100,
  goroutines: [
    {
      id: 1,
      name: 'main.a',
      createdAt: 0,
      endedAt: 100,
      intervals: [
        { start: 0, end: 40, state: 'running', blockReason: '' },
        { start: 40, end: 100, state: 'blocked', blockReason: 'chan receive' },
      ],
    },
    {
      id: 2,
      name: '',
      createdAt: 10,
      endedAt: 0, // never ended -> extends to endTime
      intervals: [{ start: 10, end: 60, state: 'running', blockReason: '' }],
    },
  ],
  edges: [],
}

describe('layoutTimeline', () => {
  it('produces one lane per goroutine with stacked y positions', () => {
    const lanes = layoutTimeline(summary, { width: 200, laneHeight: 20, laneGap: 4 })
    expect(lanes).toHaveLength(2)
    expect(lanes[0].label).toBe('main.a')
    expect(lanes[1].label).toBe('g2') // empty name fallback
    expect(lanes[0].y).toBe(0)
    expect(lanes[1].y).toBe(24) // laneHeight + laneGap
  })

  it('maps interval times to pixel x/width across the full trace span', () => {
    const lanes = layoutTimeline(summary, { width: 200, laneHeight: 20, laneGap: 4 })
    const first = lanes[0].rects[0]
    expect(first.x).toBe(0) // t=0 -> 0px
    expect(first.width).toBe(80) // 40/100 * 200
    const second = lanes[0].rects[1]
    expect(second.x).toBe(80) // t=40 -> 80px
    expect(second.blockReason).toBe('chan receive')
  })

  it('never emits negative or zero-floored widths for tiny intervals', () => {
    const tiny: TraceSummary = {
      startTime: 0,
      endTime: 1_000_000,
      goroutines: [
        {
          id: 1,
          name: 'x',
          createdAt: 0,
          endedAt: 1_000_000,
          intervals: [{ start: 0, end: 1, state: 'running', blockReason: '' }],
        },
      ],
      edges: [],
    }
    const lanes = layoutTimeline(tiny, { width: 1000, laneHeight: 20, laneGap: 4 })
    expect(lanes[0].rects[0].width).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Create the shared types file the test imports**

Create `frontend/src/lib/types.ts`:
```ts
// Frontend mirror of the Go model.TraceSummary JSON contract (internal/model).
// Kept hand-written and minimal so lib/ has no dependency on generated wailsjs.
import type { IntervalState } from './format'

export interface Interval {
  start: number
  end: number
  state: IntervalState
  blockReason?: string
}

export interface Goroutine {
  id: number
  name: string
  createdAt: number
  endedAt: number
  intervals: Interval[]
}

export interface CausalEdge {
  from: number
  to: number
  time: number
  category: 'channel' | 'mutex' | 'other'
}

export interface TraceSummary {
  startTime: number
  endTime: number
  goroutines: Goroutine[]
  edges: CausalEdge[]
}
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- timelineLayout
```
Expected: FAIL — cannot find `./timelineLayout`.

- [ ] **Step 4: Write the implementation**

Create `frontend/src/lib/timelineLayout.ts`:
```ts
import { makeTimeScale } from './timeMap'
import { goroutineLabel, effectiveEnd, stateColor, type IntervalState } from './format'
import type { TraceSummary } from './types'

export interface LayoutRect {
  x: number
  width: number
  state: IntervalState
  color: string
  blockReason: string
}

export interface Lane {
  goroutineId: number
  label: string
  y: number
  height: number
  rects: LayoutRect[]
}

export interface LayoutOptions {
  width: number // pixel width of the time axis
  laneHeight: number
  laneGap: number
}

// layoutTimeline maps the whole trace span onto [0, width] and produces one
// lane per goroutine. Each interval becomes a rect with a minimum width of 1px
// so sub-pixel intervals stay visible.
export function layoutTimeline(summary: TraceSummary, opts: LayoutOptions): Lane[] {
  const scale = makeTimeScale(summary.startTime, summary.endTime, 0, opts.width)
  return summary.goroutines.map((g, i) => {
    const rects: LayoutRect[] = g.intervals.map((iv) => {
      const end = iv.end === 0 ? effectiveEnd(g, summary.endTime) : iv.end
      const x = scale.toPixel(iv.start)
      const rawWidth = scale.toPixel(end) - x
      return {
        x,
        width: Math.max(1, rawWidth),
        state: iv.state,
        color: stateColor(iv.state),
        blockReason: iv.blockReason ?? '',
      }
    })
    return {
      goroutineId: g.id,
      label: goroutineLabel(g),
      y: i * (opts.laneHeight + opts.laneGap),
      height: opts.laneHeight,
      rects,
    }
  })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- timelineLayout
```
Expected: all tests PASS.

- [ ] **Step 6: Run the full frontend suite**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test
```
Expected: timeMap, format, timelineLayout suites all PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/types.ts frontend/src/lib/timelineLayout.ts frontend/src/lib/timelineLayout.test.ts
git commit -m "feat(frontend): add pure timeline layout"
```

---

## Task 6: Trace store with playhead

**Files:** Create `frontend/src/stores/trace.ts`; Test `frontend/src/stores/trace.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/stores/trace.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { get } from 'svelte/store'
import { createTraceStore } from './trace'
import type { TraceSummary } from '../lib/types'

const summary: TraceSummary = {
  startTime: 100,
  endTime: 200,
  goroutines: [{ id: 1, name: 'a', createdAt: 100, endedAt: 200, intervals: [] }],
  edges: [],
}

describe('createTraceStore', () => {
  it('starts empty', () => {
    const s = createTraceStore()
    expect(get(s.summary)).toBeNull()
  })

  it('loadSummary sets the summary and resets the playhead to startTime', () => {
    const s = createTraceStore()
    s.loadSummary(summary)
    expect(get(s.summary)).toEqual(summary)
    expect(get(s.playhead)).toBe(100)
  })

  it('setPlayhead clamps to [startTime, endTime]', () => {
    const s = createTraceStore()
    s.loadSummary(summary)
    s.setPlayhead(50)
    expect(get(s.playhead)).toBe(100)
    s.setPlayhead(999)
    expect(get(s.playhead)).toBe(200)
    s.setPlayhead(150)
    expect(get(s.playhead)).toBe(150)
  })

  it('setPlayhead is a no-op when no summary is loaded', () => {
    const s = createTraceStore()
    s.setPlayhead(150)
    expect(get(s.playhead)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- stores/trace
```
Expected: FAIL — cannot find `./trace`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/stores/trace.ts`:
```ts
import { writable, type Writable } from 'svelte/store'
import type { TraceSummary } from '../lib/types'

export interface TraceStore {
  summary: Writable<TraceSummary | null>
  playhead: Writable<number>
  loadSummary(s: TraceSummary): void
  setPlayhead(t: number): void
}

// createTraceStore holds the loaded trace and the current playhead time.
// Playhead is always clamped to the loaded trace's [startTime, endTime].
export function createTraceStore(): TraceStore {
  const summary = writable<TraceSummary | null>(null)
  const playhead = writable<number>(0)
  let current: TraceSummary | null = null

  return {
    summary,
    playhead,
    loadSummary(s) {
      current = s
      summary.set(s)
      playhead.set(s.startTime)
    },
    setPlayhead(t) {
      if (!current) return
      const clamped = Math.min(current.endTime, Math.max(current.startTime, t))
      playhead.set(clamped)
    },
  }
}

// The app-wide singleton store.
export const traceStore = createTraceStore()
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- stores/trace
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/stores/trace.ts frontend/src/stores/trace.test.ts
git commit -m "feat(frontend): add trace store with clamped playhead"
```

---

## Task 7: TimelineCanvas component + App wiring (manual-verified)

This task assembles the UI. The drawing and DOM interaction are verified visually with `wails dev`, since canvas pixels aren't unit-testable. The layout math it relies on is already tested (Tasks 3–5).

**Files:** Create `frontend/src/components/TimelineCanvas.svelte`; Replace `frontend/src/App.svelte`.

- [ ] **Step 1: Write the TimelineCanvas component**

Create `frontend/src/components/TimelineCanvas.svelte`:
```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import { traceStore } from '../stores/trace'
  import { layoutTimeline, type Lane } from '../lib/timelineLayout'
  import { makeTimeScale } from '../lib/timeMap'
  import type { TraceSummary } from '../lib/types'

  const { summary, playhead, setPlayhead } = traceStore

  let canvas: HTMLCanvasElement
  let width = 800
  let height = 400
  const LANE_H = 18
  const LANE_GAP = 3

  let lanes: Lane[] = []
  let current: TraceSummary | null = null
  let dragging = false

  summary.subscribe((s) => {
    current = s
    relayout()
    draw()
  })
  playhead.subscribe(() => draw())

  function relayout() {
    if (!current) {
      lanes = []
      return
    }
    height = Math.max(400, current.goroutines.length * (LANE_H + LANE_GAP))
    lanes = layoutTimeline(current, { width, laneHeight: LANE_H, laneGap: LANE_GAP })
  }

  function draw() {
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#0f1117'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    for (const lane of lanes) {
      for (const r of lane.rects) {
        ctx.fillStyle = r.color
        ctx.fillRect(r.x, lane.y, r.width, lane.height)
      }
    }

    if (current) {
      const scale = makeTimeScale(current.startTime, current.endTime, 0, width)
      let ph = 0
      playhead.subscribe((v) => (ph = v))()
      const x = scale.toPixel(ph)
      ctx.strokeStyle = '#5b8def'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
  }

  function timeAtClientX(clientX: number): number {
    if (!current) return 0
    const rect = canvas.getBoundingClientRect()
    const scale = makeTimeScale(current.startTime, current.endTime, 0, width)
    return scale.toTime(clientX - rect.left)
  }

  function onPointerDown(e: PointerEvent) {
    dragging = true
    setPlayhead(timeAtClientX(e.clientX))
  }
  function onPointerMove(e: PointerEvent) {
    if (dragging) setPlayhead(timeAtClientX(e.clientX))
  }
  function onPointerUp() {
    dragging = false
  }

  onMount(() => {
    relayout()
    draw()
    window.addEventListener('pointerup', onPointerUp)
    return () => window.removeEventListener('pointerup', onPointerUp)
  })
</script>

<canvas
  bind:this={canvas}
  {width}
  {height}
  on:pointerdown={onPointerDown}
  on:pointermove={onPointerMove}
  style="width:100%; cursor: ew-resize; display:block;"
></canvas>
```

- [ ] **Step 2: Replace App.svelte with the timeline UI**

Replace `frontend/src/App.svelte` with this exact content:
```svelte
<script lang="ts">
  import { OpenTraceDialog } from '../wailsjs/go/main/App'
  import { traceStore } from './stores/trace'
  import type { TraceSummary } from './lib/types'
  import TimelineCanvas from './components/TimelineCanvas.svelte'

  const { summary } = traceStore
  let error = ''
  let loading = false

  async function open() {
    error = ''
    loading = true
    try {
      const s = (await OpenTraceDialog()) as TraceSummary | null
      if (s) traceStore.loadSummary(s)
    } catch (e) {
      error = String(e)
    } finally {
      loading = false
    }
  }
</script>

<main>
  <header>
    <button on:click={open} disabled={loading}>Open trace…</button>
    {#if $summary}
      <span class="info">
        {$summary.goroutines.length} goroutines · {$summary.edges.length} edges ·
        {(($summary.endTime - $summary.startTime) / 1e6).toFixed(1)} ms
      </span>
    {/if}
    {#if error}<span class="error">{error}</span>{/if}
  </header>

  {#if $summary}
    <section class="timeline"><TimelineCanvas /></section>
  {:else}
    <section class="empty">Open a Go execution trace (.out) to begin.</section>
  {/if}
</main>

<style>
  main { font-family: system-ui, sans-serif; color: #cdd3df; background: #0f1117; height: 100vh; display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #2a2e38; }
  button { background: #5b8def; color: white; border: 0; padding: 6px 12px; border-radius: 6px; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: default; }
  .info { font-size: 13px; color: #8a93a3; }
  .error { color: #c25450; font-size: 13px; }
  .timeline { flex: 1; overflow: auto; }
  .empty { flex: 1; display: flex; align-items: center; justify-content: center; color: #5b6270; }
</style>
```

- [ ] **Step 3: Type-check the frontend**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm run check
```
Expected: `svelte-check` passes with 0 errors (warnings about a11y are acceptable). If `OpenTraceDialog`'s generated return type differs, cast via `as unknown as TraceSummary` at the call site only.

- [ ] **Step 4: Run the full frontend unit suite**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test
```
Expected: all lib/store suites PASS (unchanged).

- [ ] **Step 5: Manual visual verification with `wails dev`**

Run:
```bash
cd /Users/user/GolandProjects/trace-go
go run ./cmd/tracedump --help 2>/dev/null; true
# Generate a real trace to open:
mkdir -p /tmp/tg2 && cat > /tmp/tg2/main.go <<'GO'
package main
import ("os";"runtime/trace";"sync")
func main(){ f,_:=os.Create("/tmp/tg2/trace.out"); trace.Start(f); ch:=make(chan int); var wg sync.WaitGroup; for i:=0;i<6;i++{wg.Add(1); go func(){defer wg.Done(); ch<-1}()}; go func(){for i:=0;i<6;i++{<-ch}}(); wg.Wait(); trace.Stop(); f.Close() }
GO
( cd /tmp/tg2 && go run main.go )
wails dev
```
Then in the app window: click **Open trace…**, choose `/tmp/tg2/trace.out`, and confirm:
1. The header shows a non-zero goroutine/edge count and a millisecond duration.
2. The timeline shows horizontal lanes with green (running) / red (blocked) / gray (runnable) segments.
3. Dragging across the canvas moves the blue playhead line and it tracks the cursor.

This step requires a human (or a screenshot tool) to confirm the visuals. Report what was observed. If `wails dev` cannot launch in this environment, report DONE_WITH_CONCERNS and note that the Go build, binding test, type-check, and all unit tests passed — leaving only the live visual check for the human.

- [ ] **Step 6: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/App.svelte frontend/src/components/TimelineCanvas.svelte
git commit -m "feat(frontend): timeline canvas with file open and scrub"
```

---

## Self-Review Notes

- **Spec coverage:** Scaffold/Wails desktop (spec §2, phase 0) → Task 0. Go↔frontend binding with "heavy compute in Go, draw in JS" boundary (spec §2) → Task 1. Timeline lanes with state colors + block reasons (spec §4 upper, phase 3) → Tasks 4–5, 7. Playhead drag/scrub (spec §4 interaction) → Tasks 6–7. Pure-function unit tests with components thin (spec §6 frontend strategy) → Tasks 3–6. Data-contract limitations (empty name, endedAt sentinel, missing blockReason, time normalization) → Task 4 + layout + the contract section.
- **Deferred to Plan 2B (not in this plan):** live graph view, force layout, playback/animation, batched speed control, timeline↔graph sync, goroutine click cross-highlight, zoom/pan polish, virtual scrolling for many lanes, system-goroutine filtering.
- **Type consistency:** `TraceSummary`/`Goroutine`/`Interval`/`CausalEdge` (frontend `lib/types.ts`) mirror `internal/model` JSON tags. `IntervalState`, `makeTimeScale`/`TimeScale`, `layoutTimeline`/`Lane`/`LayoutRect`/`LayoutOptions`, `createTraceStore`/`TraceStore`, `OpenTrace`/`OpenTraceDialog` are used consistently across tasks.
- **Manual-verification honesty:** Only Task 0 Step 7 and Task 7 Step 5 require a running GUI; every other step is automated (Go tests, Vitest, type-check, builds). Both manual steps have an explicit DONE_WITH_CONCERNS fallback if the environment can't launch the window.
- **Known minor:** `wails.json` author fields come from local git config; harmless. Generated `frontend/wailsjs/` is committed (Task 1 Step 6) so the frontend type-checks without a prior `wails generate`.
