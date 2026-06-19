# trace-go Plan 2B — Playback + System-Goroutine Filtering

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the timeline *play* — add play/pause/speed controls that animate the playhead over time — and let the user hide the noisy parked `runtime.*` system goroutines, so the timeline focuses on the program's own goroutines.

**Architecture:** All new view logic is pure, unit-tested TypeScript: a `nextPlayhead` advance function (real-ms → trace-ns) and a `isSystemGoroutine`/`visibleGoroutines` filter. The existing `traceStore` gains playback state (`playing`, `speed`) and a filter flag (`showSystem`) plus an `advance(dtMs)` step that is driven by a thin `requestAnimationFrame` loop (the only non-pure glue). The existing `TimelineCanvas` already redraws on `$playhead`, so playback "just works" visually once the driver ticks `setPlayhead`; the canvas only changes to lay out the *filtered* goroutine list. A new `Controls` component adds the buttons.

**Tech Stack:** Svelte 3 + TypeScript + Vite, Vitest. No new dependencies (uses built-in `requestAnimationFrame`).

**Scope note:** This is Plan 2B of the `trace-go` v1 spec (`docs/superpowers/specs/2026-06-19-concurrency-visualizer-design.md`). It implements the **playback controls** (spec §4 interaction: play/pause, speed 0.25×–4×) and **system-goroutine filtering** (anticipated by the Plan 1 final review and spec §4 "중간 규모 대응"). The **live force-directed graph view + timeline↔graph sync + click cross-highlight (spec §4 lower half)** is **Plan 2C**, built on the playback foundation here. Plans 1 and 2A are merged on `main`.

**Current state (verified):** `frontend/src/stores/trace.ts` exposes `summary`/`playhead` + `loadSummary`/`setPlayhead` (playhead clamped to `[startTime,endTime]`). `frontend/src/components/TimelineCanvas.svelte` renders all goroutines via `layoutTimeline` and redraws reactively on `$playhead`. `frontend/src/App.svelte` has only an "Open trace…" button in the header. `lib/` has `timeMap`, `format`, `timelineLayout`, `types`. 15 vitest tests pass.

---

## File Structure

- `frontend/src/lib/playback.ts` — pure `nextPlayhead(...)` advance math. Test: `playback.test.ts`.
- `frontend/src/lib/filter.ts` — pure `isSystemGoroutine(g)` + `visibleGoroutines(summary, showSystem)`. Test: `filter.test.ts`.
- `frontend/src/stores/trace.ts` — **modify**: add `playing`/`speed`/`showSystem` writables, `play`/`pause`/`toggle`/`setSpeed`/`setShowSystem`, and a testable `advance(dtMs)` step + an rAF driver. Test: extend `trace.test.ts`.
- `frontend/src/components/Controls.svelte` — **new**: play/pause button, speed `<select>`, "Show system goroutines" checkbox. (Visual; manual-verified.)
- `frontend/src/components/TimelineCanvas.svelte` — **modify**: lay out `visibleGoroutines($summary, $showSystem)` instead of all goroutines. (Visual; manual-verified.)
- `frontend/src/App.svelte` — **modify**: render `<Controls/>` in the header when a trace is loaded. (Visual; manual-verified.)

**Pure-logic-first:** playback math and the filter predicate are TDD'd in `lib/`; the store's state transitions are unit-tested via the synchronous `advance(dtMs)` step (no rAF needed in tests); only the rAF loop and the three Svelte view edits are manual-verified.

---

## Task 1: Pure playback advance math

`nextPlayhead` maps elapsed real milliseconds to advanced trace time. At `1×`, the whole trace plays over `BASE_PLAY_MS` (4000 ms) of real time; `speed` multiplies that rate.

**Files:** Create `frontend/src/lib/playback.ts`; Test `frontend/src/lib/playback.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/playback.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { nextPlayhead, BASE_PLAY_MS } from './playback'

describe('nextPlayhead', () => {
  // span = 1000, base = 4000ms => 1x plays full span in 4000ms.
  it('advances proportionally to elapsed real time at 1x', () => {
    const r = nextPlayhead(0, BASE_PLAY_MS / 2, 1, 0, 1000)
    expect(r.time).toBeCloseTo(500) // half the base time -> half the span
    expect(r.atEnd).toBe(false)
  })

  it('scales the advance by speed', () => {
    const r = nextPlayhead(0, BASE_PLAY_MS / 2, 2, 0, 1000)
    expect(r.time).toBeCloseTo(1000) // 2x -> full span in half the base time
    expect(r.atEnd).toBe(true) // reached the end
  })

  it('clamps at endTime and reports atEnd', () => {
    const r = nextPlayhead(900, BASE_PLAY_MS, 1, 0, 1000)
    expect(r.time).toBe(1000)
    expect(r.atEnd).toBe(true)
  })

  it('does not move on a zero-width trace', () => {
    const r = nextPlayhead(500, 16, 1, 500, 500)
    expect(r.time).toBe(500)
    expect(r.atEnd).toBe(true) // already at (the only) end
  })

  it('respects a custom base duration', () => {
    const r = nextPlayhead(0, 1000, 1, 0, 1000, 1000)
    expect(r.time).toBeCloseTo(1000)
    expect(r.atEnd).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- playback
```
Expected: FAIL — cannot find `./playback`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/playback.ts`:
```ts
// Real-time playback advance for the timeline playhead.

// At 1x speed, the entire trace span plays over BASE_PLAY_MS of wall-clock time.
export const BASE_PLAY_MS = 4000

export interface Advance {
  time: number // new playhead time (trace ns), clamped to [startTime, endTime]
  atEnd: boolean // true once the playhead reaches endTime
}

// nextPlayhead advances `current` by `dtMs` of real time at `speed`, mapping the
// whole [startTime, endTime] span onto baseMs of real time. The result is
// clamped to endTime; atEnd is true once the end is reached (or the span is 0).
export function nextPlayhead(
  current: number,
  dtMs: number,
  speed: number,
  startTime: number,
  endTime: number,
  baseMs: number = BASE_PLAY_MS,
): Advance {
  const span = endTime - startTime
  if (span <= 0) return { time: endTime, atEnd: true }
  const delta = (dtMs / baseMs) * span * speed
  const next = current + delta
  if (next >= endTime) return { time: endTime, atEnd: true }
  return { time: next, atEnd: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- playback
```
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/playback.ts frontend/src/lib/playback.test.ts
git commit -m "feat(frontend): add pure playback advance math"
```

---

## Task 2: System-goroutine filter

**Files:** Create `frontend/src/lib/filter.ts`; Test `frontend/src/lib/filter.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/filter.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isSystemGoroutine, visibleGoroutines } from './filter'
import type { TraceSummary } from './types'

describe('isSystemGoroutine', () => {
  it('flags runtime.* and runtime/* goroutines', () => {
    expect(isSystemGoroutine({ id: 2, name: 'runtime.forcegchelper' })).toBe(true)
    expect(isSystemGoroutine({ id: 3, name: 'runtime.bgsweep' })).toBe(true)
    expect(isSystemGoroutine({ id: 21, name: 'runtime/trace.(*traceMultiplexer).startLocked.func1' })).toBe(true)
  })

  it('does NOT flag the main goroutine (empty name) or user goroutines', () => {
    expect(isSystemGoroutine({ id: 1, name: '' })).toBe(false)
    expect(isSystemGoroutine({ id: 22, name: 'main.main.func1' })).toBe(false)
  })
})

describe('visibleGoroutines', () => {
  const summary = {
    startTime: 0,
    endTime: 100,
    goroutines: [
      { id: 1, name: '', createdAt: 0, endedAt: 100, intervals: [] },
      { id: 2, name: 'runtime.bgsweep', createdAt: 0, endedAt: 0, intervals: [] },
      { id: 22, name: 'main.main.func1', createdAt: 0, endedAt: 100, intervals: [] },
    ],
    edges: [],
  } as TraceSummary

  it('hides system goroutines when showSystem is false', () => {
    const v = visibleGoroutines(summary, false)
    expect(v.map((g) => g.id)).toEqual([1, 22])
  })

  it('returns all goroutines when showSystem is true', () => {
    const v = visibleGoroutines(summary, true)
    expect(v.map((g) => g.id)).toEqual([1, 2, 22])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- filter
```
Expected: FAIL — cannot find `./filter`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/filter.ts`:
```ts
import type { Goroutine, TraceSummary } from './types'

// isSystemGoroutine reports whether a goroutine is a Go runtime internal
// (forcegchelper, bgsweep, trace plumbing, etc.). These are parked for most or
// all of a trace and add noise to the timeline. The main goroutine has an empty
// name and is intentionally NOT treated as a system goroutine.
export function isSystemGoroutine(g: Pick<Goroutine, 'id' | 'name'>): boolean {
  return g.name.startsWith('runtime.') || g.name.startsWith('runtime/')
}

// visibleGoroutines returns the goroutines to render given the showSystem flag,
// preserving the summary's ordering.
export function visibleGoroutines(summary: TraceSummary, showSystem: boolean): Goroutine[] {
  if (showSystem) return summary.goroutines
  return summary.goroutines.filter((g) => !isSystemGoroutine(g))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- filter
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/lib/filter.ts frontend/src/lib/filter.test.ts
git commit -m "feat(frontend): add system-goroutine filter"
```

---

## Task 3: Playback + filter state in the trace store

Extends the store with `playing`/`speed`/`showSystem`, a synchronous `advance(dtMs)` step (unit-tested), and an rAF driver (thin glue, guarded for the test environment).

**Files:** Modify `frontend/src/stores/trace.ts`; Test: extend `frontend/src/stores/trace.test.ts`.

- [ ] **Step 1: Write the failing tests (append to existing file)**

Append to `frontend/src/stores/trace.test.ts`:
```ts
import { nextPlayhead } from '../lib/playback'

describe('createTraceStore playback', () => {
  const summary = {
    startTime: 0,
    endTime: 1000,
    goroutines: [{ id: 1, name: 'a', createdAt: 0, endedAt: 1000, intervals: [] }],
    edges: [],
  } as TraceSummary

  it('defaults: not playing, speed 1, system hidden', () => {
    const s = createTraceStore()
    expect(get(s.playing)).toBe(false)
    expect(get(s.speed)).toBe(1)
    expect(get(s.showSystem)).toBe(false)
  })

  it('toggle play requires a loaded summary', () => {
    const s = createTraceStore()
    s.play()
    expect(get(s.playing)).toBe(false) // nothing loaded -> stays paused
    s.loadSummary(summary)
    s.play()
    expect(get(s.playing)).toBe(true)
    s.pause()
    expect(get(s.playing)).toBe(false)
  })

  it('advance moves the playhead and auto-pauses at the end', () => {
    const s = createTraceStore()
    s.loadSummary(summary)
    s.play()
    s.setSpeed(1)
    s.advance(2000) // half of BASE_PLAY_MS(4000) at 1x -> ~500
    expect(get(s.playhead)).toBeCloseTo(500)
    expect(get(s.playing)).toBe(true)
    s.advance(10000) // overshoot -> clamps to end and pauses
    expect(get(s.playhead)).toBe(1000)
    expect(get(s.playing)).toBe(false)
  })

  it('play() from the end restarts at startTime', () => {
    const s = createTraceStore()
    s.loadSummary(summary)
    s.setPlayhead(1000) // at end
    s.play()
    expect(get(s.playhead)).toBe(0) // reset to start before playing
    expect(get(s.playing)).toBe(true)
  })

  it('setShowSystem updates the flag', () => {
    const s = createTraceStore()
    s.setShowSystem(true)
    expect(get(s.showSystem)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- stores/trace
```
Expected: FAIL — `s.playing`, `s.play`, `s.advance`, etc. are undefined.

- [ ] **Step 3: Rewrite the store**

Replace `frontend/src/stores/trace.ts` with:
```ts
import { writable, get, type Writable } from 'svelte/store'
import type { TraceSummary } from '../lib/types'
import { nextPlayhead } from '../lib/playback'

export interface TraceStore {
  summary: Writable<TraceSummary | null>
  playhead: Writable<number>
  playing: Writable<boolean>
  speed: Writable<number>
  showSystem: Writable<boolean>
  loadSummary(s: TraceSummary): void
  setPlayhead(t: number): void
  play(): void
  pause(): void
  toggle(): void
  setSpeed(n: number): void
  setShowSystem(v: boolean): void
  advance(dtMs: number): void
}

// createTraceStore holds the loaded trace, the playhead, and playback/filter
// state. The playhead is always clamped to [startTime, endTime]. Playback is
// driven by requestAnimationFrame, but the per-frame step (advance) is a plain
// method so it can be unit-tested without a real animation frame.
export function createTraceStore(): TraceStore {
  const summary = writable<TraceSummary | null>(null)
  const playhead = writable<number>(0)
  const playing = writable<boolean>(false)
  const speed = writable<number>(1)
  const showSystem = writable<boolean>(false)
  let current: TraceSummary | null = null
  let rafId = 0
  let lastFrame = 0

  function clampSet(t: number) {
    if (!current) return
    playhead.set(Math.min(current.endTime, Math.max(current.startTime, t)))
  }

  function stopRaf() {
    if (rafId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId)
    rafId = 0
  }

  function frame(now: number) {
    const dt = lastFrame === 0 ? 16 : now - lastFrame
    lastFrame = now
    api.advance(dt)
    if (get(playing) && typeof requestAnimationFrame !== 'undefined') {
      rafId = requestAnimationFrame(frame)
    }
  }

  const api: TraceStore = {
    summary,
    playhead,
    playing,
    speed,
    showSystem,
    loadSummary(s) {
      current = s
      summary.set(s)
      playhead.set(s.startTime)
      api.pause()
    },
    setPlayhead(t) {
      clampSet(t)
    },
    play() {
      if (!current) return
      // Restart from the beginning if parked at the end.
      if (get(playhead) >= current.endTime) playhead.set(current.startTime)
      playing.set(true)
      lastFrame = 0
      if (typeof requestAnimationFrame !== 'undefined') rafId = requestAnimationFrame(frame)
    },
    pause() {
      playing.set(false)
      stopRaf()
    },
    toggle() {
      get(playing) ? api.pause() : api.play()
    },
    setSpeed(n) {
      speed.set(n)
    },
    setShowSystem(v) {
      showSystem.set(v)
    },
    advance(dtMs) {
      if (!current) return
      const r = nextPlayhead(get(playhead), dtMs, get(speed), current.startTime, current.endTime)
      playhead.set(r.time)
      if (r.atEnd) api.pause()
    },
  }
  return api
}

// The app-wide singleton store.
export const traceStore = createTraceStore()
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test -- stores/trace
```
Expected: all store tests PASS (the original 4 + the 5 new playback tests).

- [ ] **Step 5: Run the full suite**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm test
```
Expected: playback, filter, timeMap, format, timelineLayout, stores/trace suites all PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/stores/trace.ts frontend/src/stores/trace.test.ts
git commit -m "feat(frontend): add playback and filter state to trace store"
```

---

## Task 4: Controls component (manual-verified)

**Files:** Create `frontend/src/components/Controls.svelte`; Modify `frontend/src/App.svelte`.

- [ ] **Step 1: Write the Controls component**

Create `frontend/src/components/Controls.svelte`:
```svelte
<script lang="ts">
  import { traceStore } from '../stores/trace'

  const { playing, speed, showSystem } = traceStore
  const SPEEDS = [0.25, 0.5, 1, 2, 4]

  function onSpeed(e: Event) {
    traceStore.setSpeed(Number((e.target as HTMLSelectElement).value))
  }
  function onSystem(e: Event) {
    traceStore.setShowSystem((e.target as HTMLInputElement).checked)
  }
</script>

<div class="controls">
  <button class="play" on:click={() => traceStore.toggle()} title="Play/Pause (Space)">
    {$playing ? '⏸' : '▶'}
  </button>

  <label class="speed">
    Speed
    <select on:change={onSpeed} value={$speed}>
      {#each SPEEDS as s}
        <option value={s}>{s}×</option>
      {/each}
    </select>
  </label>

  <label class="sys">
    <input type="checkbox" checked={$showSystem} on:change={onSystem} />
    Show system goroutines
  </label>
</div>

<style>
  .controls { display: flex; align-items: center; gap: 14px; }
  .play { background: #2a2e38; color: #cdd3df; border: 0; width: 30px; height: 30px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .speed, .sys { font-size: 13px; color: #8a93a3; display: flex; align-items: center; gap: 6px; }
  select { background: #161922; color: #cdd3df; border: 1px solid #2a2e38; border-radius: 4px; padding: 2px 4px; }
</style>
```

- [ ] **Step 2: Wire Controls into App.svelte and add a Space-to-toggle shortcut**

In `frontend/src/App.svelte`, update the `<script>` to import Controls and add a keydown handler, and render `<Controls/>` in the header.

Change the import block (after the existing imports) to add:
```svelte
  import Controls from './components/Controls.svelte'
```

Add this handler inside the `<script>` (after the `open` function):
```svelte
  function onKeydown(e: KeyboardEvent) {
    if (e.code === 'Space' && $summary) {
      e.preventDefault()
      traceStore.toggle()
    }
  }
```

Register the keyboard shortcut by adding a `<svelte:window>` tag immediately before the opening `<main>` tag (between the closing `</script>` and `<main>`):
```svelte
<svelte:window on:keydown={onKeydown} />
```

Finally, in the header, render Controls next to the info line. Replace the header block:
```svelte
  <header>
    <button on:click={open} disabled={loading}>Open trace…</button>
    {#if $summary}
      <span class="info">
        {$summary.goroutines.length} goroutines · {$summary.edges.length} edges ·
        {(($summary.endTime - $summary.startTime) / 1e6).toFixed(1)} ms
      </span>
      <Controls />
    {/if}
    {#if error}<span class="error">{error}</span>{/if}
  </header>
```

- [ ] **Step 3: Type-check**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm run check
```
Expected: 0 errors (a11y hints/warnings acceptable).

- [ ] **Step 4: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/components/Controls.svelte frontend/src/App.svelte
git commit -m "feat(frontend): add playback/filter controls to header"
```

---

## Task 5: Filter the timeline + verify playback (manual-verified)

**Files:** Modify `frontend/src/components/TimelineCanvas.svelte`.

- [ ] **Step 1: Lay out only the visible goroutines**

In `frontend/src/components/TimelineCanvas.svelte`, import the filter and the `showSystem` store, and feed the filtered list to `layoutTimeline`.

Update the imports to add:
```svelte
  import { visibleGoroutines } from '../lib/filter'
```

Destructure `showSystem` from the store — change:
```svelte
  const { summary, playhead, setPlayhead } = traceStore
```
to:
```svelte
  const { summary, playhead, showSystem, setPlayhead } = traceStore
```

Change the reactive `lanes`/`cssHeight` blocks to use the filtered goroutines (so they depend on `$showSystem`):
```svelte
  $: visible = $summary ? visibleGoroutines($summary, $showSystem) : []
  $: lanes = $summary
    ? layoutTimeline(
        { ...$summary, goroutines: visible },
        { width: cssWidth, laneHeight: LANE_H, laneGap: LANE_GAP },
      )
    : ([] as Lane[])
  $: cssHeight = Math.max(400, visible.length * (LANE_H + LANE_GAP))
```

(Leave the rest of the component — drawing, scrub, ResizeObserver — unchanged. The reactive `$: void [$playhead, lanes, cssWidth, cssHeight], draw()` line already redraws when `lanes` change, so toggling the filter repaints automatically.)

- [ ] **Step 2: Type-check and run the full unit suite**

Run:
```bash
cd /Users/user/GolandProjects/trace-go/frontend
npm run check && npm test
```
Expected: 0 check errors; all unit suites still pass (playback, filter, timeMap, format, timelineLayout, stores/trace).

- [ ] **Step 3: Build the app**

Run:
```bash
cd /Users/user/GolandProjects/trace-go
wails build
```
Expected: builds successfully (frontend bundles, binary links). This is the automated gate that the new components compile in the production build.

- [ ] **Step 4: Manual visual verification (human)**

Run `wails dev` (or open `build/bin/trace-go.app`), open a trace (e.g. `~/Desktop/trace.out`), and confirm:
1. With **"Show system goroutines"** unchecked (default), the parked `runtime.*` lanes (the right-edge slivers) are gone and only main + user/worker goroutines show. Checking the box brings them back.
2. Clicking **▶** animates the blue playhead smoothly left→right; it auto-stops (▶ returns) at the right edge.
3. Changing **Speed** (e.g. 0.25× vs 4×) visibly slows/speeds the animation.
4. **Space** toggles play/pause. Manual scrub (drag) still works.

This step needs a human (or the controller running the app for the user). Report observations. If `wails dev` can't launch in the environment, report DONE_WITH_CONCERNS noting that build + type-check + all unit tests passed and only the live check remains.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/GolandProjects/trace-go
git add frontend/src/components/TimelineCanvas.svelte
git commit -m "feat(frontend): filter system goroutines from the timeline"
```

---

## Self-Review Notes

- **Spec coverage:** Playback play/pause/speed (spec §4 interaction: "재생/일시정지, 배속 0.25x~4x, 스페이스=재생토글") → Tasks 1, 3, 4. System-goroutine filtering (spec §4 "중간 규모 대응" + Plan 1 review's anticipated filter) → Tasks 2, 3, 5. Pure-logic-unit-tested, components-thin (spec §6) → Tasks 1–3 are TDD'd; only Controls + two reactive edits are manual.
- **Deferred to Plan 2C:** live force-directed graph view, timeline↔graph two-way sync, goroutine click cross-highlight, edge "flash" on unblock, virtual scrolling for very large goroutine counts.
- **Type consistency:** `nextPlayhead`/`Advance`/`BASE_PLAY_MS` (playback.ts), `isSystemGoroutine`/`visibleGoroutines` (filter.ts), and the extended `TraceStore` interface (`playing`/`speed`/`showSystem`/`play`/`pause`/`toggle`/`setSpeed`/`setShowSystem`/`advance`) are used consistently across tasks and tests. `visibleGoroutines` returns `Goroutine[]` matching `types.ts`.
- **Testability of the rAF driver:** the per-frame work is the pure `advance(dtMs)` method, fully unit-tested (advance, auto-pause-at-end, restart-from-end). The `requestAnimationFrame` loop is guarded with `typeof requestAnimationFrame !== 'undefined'` so the store constructs and `advance` runs under Vitest's node environment without a real animation frame.
- **No new dependencies.** Playback uses the browser's built-in rAF; everything else is existing Svelte/TS.
- **Manual-verification honesty:** only Task 5 Step 4 needs a running GUI; it has an explicit DONE_WITH_CONCERNS fallback. Build (Task 5 Step 3) is the automated compile gate.
