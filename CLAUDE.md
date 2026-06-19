# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`trace-go` is a Wails v2 desktop app that visualizes Go concurrency. It parses a Go **execution trace** (the same data `go tool trace` consumes, produced by `runtime/trace`) into a normalized model and renders a **hybrid view**: a goroutine timeline (top) plus a live, force-directed goroutine graph (bottom), both driven by a single shared playhead. Design rationale and the staged build history live in `docs/superpowers/specs/` and `docs/superpowers/plans/` — read the spec before making product/UX decisions.

Core constraint: **no runtime patching.** Unlike the project that inspired it (divan/gotrace, which patched the Go runtime and died from version churn), this tool only reads the official, stable Go 1.22+ trace format via `golang.org/x/exp/trace`.

## Commands

Go backend (run from repo root):
- `go build ./...` — build all Go packages (includes the Wails `main` package; `//go:embed all:frontend/dist` requires `frontend/dist/gitkeep` to exist — keep it tracked).
- `go test ./...` — full Go test suite.
- `go test ./internal/parse -run TestParseProducesChannelCausalEdge -v` — single Go test.
- `go run ./cmd/tracedump <trace.out>` — parse a trace and print the `TraceSummary` JSON (the fastest way to inspect parser output without the GUI).

Frontend (run from `frontend/`):
- `npm test` — Vitest unit suite. `npm test -- timelineLayout` runs one file by name substring.
- `npm run check` — `svelte-check` type-check (treat any error as blocking).
- `npm run dev` / `npm run build` — Vite dev server / production bundle (usually driven by Wails, below).

Desktop app (run from repo root; needs the `wails` CLI, Node, and a C toolchain):
- `wails dev` — hot-reloading dev app. `wails build` — production `build/bin/trace-go.app`. Either one regenerates the TypeScript bindings in `frontend/wailsjs/` from the bound Go methods.
- Generating a trace to open: run any Go program under `runtime/trace.Start/Stop` (see `app_test.go:writeSampleTrace` for the in-process pattern), then File → "Open trace…".

After `wails build`/`wails dev`, the working tree may show spurious changes to `frontend/dist/gitkeep` and `frontend/wailsjs/runtime/*` — `git checkout --` those before committing. `frontend/package.json.md5` is gitignored.

## Architecture

**One-way data pipeline:**
```
trace.out → internal/parse.Parse → model.TraceSummary (JSON) → app.OpenTrace binding
          → frontend stores/trace.ts → lib/* (pure view math) → *Canvas.svelte (draw)
```

**Layering principle — "heavy compute in Go, draw in JS":** the Go side produces a fully rendering-ready `model.TraceSummary`; the frontend never re-parses. Swapping the data source later (e.g. a different collector) would not touch the frontend. `cmd/tracedump` and the Wails `app.go` binding are both thin wrappers over `internal/parse.Parse`.

**Go packages (`internal/`):**
- `model` — pure data types only (no logic). `TraceSummary{startTime,endTime,goroutines[],edges[]}`; JSON tags are the frontend contract.
- `parse` — a **single forward pass** over `x/exp/trace` events. Builds per-goroutine state intervals (Running/Runnable/Blocked) AND causal edges in one loop. Causal edges come from `GoWaiting → GoRunnable` transitions: the goroutine that *executed* that event (`ev.Goroutine()`) is recorded as the unblocker. The block reason is captured when entering `GoWaiting` (not on the unblock) and classified via `causality`.
- `causality` — pure `Classify(reason)` → channel/mutex/other from the block-reason string.

**Frontend split — this is the testing strategy, follow it:** all view *decisions* live in pure, Vitest-tested modules under `src/lib/` (`timeMap` time↔pixel scale, `timelineLayout`, `activeAt` state-at-time + active-edges, `graphModel`, `filter`, `hit` hit-testing, `tooltip` text, `format` colors/labels). Svelte components (`TimelineCanvas`, `GraphCanvas`, `Controls`, `Legend`) are thin: they wire the pure functions to a `<canvas>` and are verified visually, not by unit tests. **When adding canvas behavior, put the math in a `lib/` function with tests and keep the component a thin renderer.** `stores/trace.ts` is the single source of truth (loaded summary, `playhead`, `playing`, `speed`, `showSystem`, `selectedId`); both canvases subscribe to it, which is what keeps the timeline and graph in lockstep.

## Invariants & gotchas (these bite if missed)

- **Graph stability:** in `GraphCanvas.svelte` the d3-force simulation must be rebuilt ONLY when the node set changes (`$summary`/`$showSystem`), never on `$playhead`/`$selectedId` — time/selection changes only *redraw* (recolor + re-emphasize) against persisted node positions. Rebuilding on playhead re-jitters the layout every frame.
- **Data-contract quirks the frontend must honor:** `name` is often `""` (main + goroutines alive at trace start) → fall back to `g<id>` (`goroutineLabel`); `endedAt === 0` is a "never ended" sentinel (≠ a real time) → extend to `endTime` (`effectiveEnd`); times are large absolute ns → normalize against `startTime` for display; a `Blocked` interval's `blockReason` may be empty; parked `runtime.*` goroutines often only appear near the trace end (their pre-history isn't in the trace — do not fabricate it) and are filtered by default via `isSystemGoroutine`.
- **Edges are inferred, not authoritative:** the trace has no channel identity or transferred values. UI labels causal edges "(inferred)" on purpose (`tooltip.ts`) — preserve that honesty.
- **Tests are invariant-based, not golden:** goroutine scheduling is nondeterministic, so Go parser tests generate a trace in-process and assert structural invariants (e.g. "an unbuffered rendezvous always yields a `chan` Blocked interval and a Channel causal edge"), never exact event sequences. Keep new tests in this style.
- **Go version:** the `go` directive is `1.25.0` because the pinned `golang.org/x/exp` requires it; the trace format support is Go 1.22+ only (old-format traces are rejected by the reader).

## Workflow conventions

Specs and implementation plans are tracked under `docs/superpowers/`. Substantial features were built plan-by-plan (parser → timeline → playback/filter → graph → tooltips), each as its own PR. Follow the existing branch-per-feature + PR flow; never commit directly to `main`.
