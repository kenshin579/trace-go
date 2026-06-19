# trace-go Backend & Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-Go backend that parses a Go 1.22+ execution trace into a normalized `TraceSummary` (goroutine timelines + inferred causal edges), exposed through a `tracedump` CLI that prints the summary as JSON.

**Architecture:** A single forward pass over the events from `golang.org/x/exp/trace` builds per-goroutine state intervals and, on every `GoWaiting → GoRunnable` transition, records a causal edge from the unblocking goroutine (`event.Goroutine()`) to the unblocked one. A separate `causality` package owns the pure "block reason → edge category" classification. A thin `cmd/tracedump` CLI wires a file to the parser and prints JSON. No Wails/frontend in this plan — that is Plan 2, written after this plan validates that real traces yield useful causal edges.

**Tech Stack:** Go 1.23+ (`runtime/trace` for test fixtures, `golang.org/x/exp/trace` for reading, range-over-func iterators), standard `testing`.

**Scope note:** This is Plan 1 of 2 for the `trace-go` v1 spec (`docs/superpowers/specs/2026-06-19-concurrency-visualizer-design.md`). It implements spec sections 3 (data model & causality) and the parser half of section 5 (phases 1–2), plus the testing strategy in section 6. The Wails app and visualization (spec sections 2, 4; phases 0, 3–5) are Plan 2.

---

## File Structure

- `go.mod` — module `github.com/kenshin579/trace-go`, Go 1.23, requires `golang.org/x/exp`.
- `internal/model/model.go` — normalized types: `Time`, `State`, `Interval`, `Goroutine`, `EdgeCategory`, `CausalEdge`, `TraceSummary`. JSON-tagged. No logic except small helpers.
- `internal/model/model_test.go` — JSON round-trip + `Interval.Duration` helper test.
- `internal/causality/causality.go` — pure `Classify(reason string) model.EdgeCategory`.
- `internal/causality/causality_test.go` — table test for `Classify`.
- `internal/parse/parse.go` — `Parse(r io.Reader) (*model.TraceSummary, error)`: the single-pass builder.
- `internal/parse/parse_test.go` — invariant tests driven by in-process generated traces.
- `internal/parse/testutil_test.go` — `genTrace` helper + concurrency scenarios (test-only, so it lives in the test package).
- `cmd/tracedump/main.go` — CLI: `tracedump <trace.out>` → JSON on stdout.

**Why invariant tests, not golden files:** goroutine scheduling is nondeterministic, so exact event sequences vary run to run. Tests assert structural invariants that always hold (e.g. "an unbuffered channel rendezvous always produces a `Blocked` interval whose reason mentions `chan` and a `Channel` causal edge between the two goroutines"). This is robust and still pins the behavior we care about.

---

## Task 1: Initialize Go module and dependency

**Files:**
- Create: `go.mod`

- [ ] **Step 1: Initialize the module**

Run:
```bash
go mod init github.com/kenshin579/trace-go
```

- [ ] **Step 2: Add the experimental trace reader dependency**

Run:
```bash
go get golang.org/x/exp/trace@latest
```
Expected: `go.mod` now contains a `require golang.org/x/exp ...` line and a `go.sum` is created.

- [ ] **Step 3: Pin the Go version**

Edit `go.mod` so the `go` directive reads `go 1.23` (required for range-over-func iterators used by `Stack.Frames()` and for the Go 1.22+ trace format). Leave the toolchain line (if any) as written by the tool.

- [ ] **Step 4: Verify it builds**

Run:
```bash
go build ./...
```
Expected: no output, exit code 0 (no packages yet, so nothing to build — this just confirms the module is valid).

- [ ] **Step 5: Commit**

```bash
git add go.mod go.sum
git commit -m "chore: init go module and add x/exp/trace dependency"
```

---

## Task 2: Core model types

**Files:**
- Create: `internal/model/model.go`
- Test: `internal/model/model_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/model/model_test.go`:
```go
package model

import (
	"encoding/json"
	"testing"
)

func TestIntervalDuration(t *testing.T) {
	iv := Interval{Start: 100, End: 250, State: StateRunning}
	if got := iv.Duration(); got != 150 {
		t.Fatalf("Duration() = %d, want 150", got)
	}
}

func TestTraceSummaryJSONRoundTrip(t *testing.T) {
	in := TraceSummary{
		StartTime: 10,
		EndTime:   90,
		Goroutines: []Goroutine{{
			ID:        1,
			Name:      "main.worker",
			CreatedAt: 10,
			EndedAt:   90,
			Intervals: []Interval{{Start: 10, End: 50, State: StateBlocked, BlockReason: "chan receive"}},
		}},
		Edges: []CausalEdge{{From: 2, To: 1, Time: 50, Category: CategoryChannel}},
	}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	var out TraceSummary
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	if out.Goroutines[0].Intervals[0].BlockReason != "chan receive" {
		t.Fatalf("round trip lost BlockReason: %+v", out)
	}
	if out.Edges[0].Category != CategoryChannel {
		t.Fatalf("round trip lost Category: %+v", out)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
go test ./internal/model/
```
Expected: FAIL — `undefined: Interval`, `undefined: StateRunning`, etc.

- [ ] **Step 3: Write the implementation**

Create `internal/model/model.go`:
```go
// Package model defines the normalized, frontend-ready representation of a
// parsed Go execution trace. It contains no parsing logic.
package model

// Time is a trace timestamp in the raw units reported by the trace reader
// (nanoseconds since an arbitrary trace-relative origin). The frontend
// normalizes against TraceSummary.StartTime for display.
type Time int64

// State is the scheduling state of a goroutine during an interval.
type State string

const (
	StateRunning  State = "running"  // executing on a processor
	StateRunnable State = "runnable" // ready to run, waiting for a processor
	StateBlocked  State = "blocked"  // waiting (channel, mutex, syscall, ...)
)

// Interval is a contiguous span during which a goroutine held a single State.
type Interval struct {
	Start Time  `json:"start"`
	End   Time  `json:"end"`
	State State `json:"state"`
	// BlockReason is set only when State == StateBlocked, e.g. "chan send",
	// "chan receive", "sync.Mutex.Lock", "syscall". Empty otherwise.
	BlockReason string `json:"blockReason,omitempty"`
}

// Duration returns the length of the interval in raw trace units.
func (iv Interval) Duration() Time { return iv.End - iv.Start }

// Goroutine is one goroutine's full lifetime and timeline.
type Goroutine struct {
	ID        int64      `json:"id"`
	Name      string     `json:"name"` // best-effort start function, may be ""
	CreatedAt Time       `json:"createdAt"`
	EndedAt   Time       `json:"endedAt"` // 0 if it never ended within the trace
	Intervals []Interval `json:"intervals"`
}

// EdgeCategory is the inferred synchronization mechanism behind a causal edge.
type EdgeCategory string

const (
	CategoryChannel EdgeCategory = "channel"
	CategoryMutex   EdgeCategory = "mutex"
	CategoryOther   EdgeCategory = "other"
)

// CausalEdge records that goroutine From unblocked goroutine To at Time.
// The trace does not expose channel identities or transferred values, so
// Category is inferred from To's block reason and is best-effort.
type CausalEdge struct {
	From     int64        `json:"from"`
	To       int64        `json:"to"`
	Time     Time         `json:"time"`
	Category EdgeCategory `json:"category"`
}

// TraceSummary is the complete rendering-ready result of parsing a trace.
type TraceSummary struct {
	StartTime  Time         `json:"startTime"`
	EndTime    Time         `json:"endTime"`
	Goroutines []Goroutine  `json:"goroutines"`
	Edges      []CausalEdge `json:"edges"`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
go test ./internal/model/
```
Expected: PASS (`ok  github.com/kenshin579/trace-go/internal/model`).

- [ ] **Step 5: Commit**

```bash
git add internal/model/
git commit -m "feat(model): add normalized trace summary types"
```

---

## Task 3: Reason classification (causality package)

**Files:**
- Create: `internal/causality/causality.go`
- Test: `internal/causality/causality_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/causality/causality_test.go`:
```go
package causality

import (
	"testing"

	"github.com/kenshin579/trace-go/internal/model"
)

func TestClassify(t *testing.T) {
	cases := []struct {
		reason string
		want   model.EdgeCategory
	}{
		{"chan send", model.CategoryChannel},
		{"chan receive", model.CategoryChannel},
		{"sync.Mutex.Lock", model.CategoryMutex},
		{"sync.WaitGroup.Wait", model.CategoryMutex},
		{"semacquire", model.CategoryMutex},
		{"select", model.CategoryOther},
		{"", model.CategoryOther},
		{"GC mark assist wait", model.CategoryOther},
	}
	for _, c := range cases {
		if got := Classify(c.reason); got != c.want {
			t.Errorf("Classify(%q) = %q, want %q", c.reason, got, c.want)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
go test ./internal/causality/
```
Expected: FAIL — `undefined: Classify`.

- [ ] **Step 3: Write the implementation**

Create `internal/causality/causality.go`:
```go
// Package causality infers the synchronization mechanism behind a goroutine
// unblock from the block reason string reported by the trace.
package causality

import (
	"strings"

	"github.com/kenshin579/trace-go/internal/model"
)

// Classify maps a goroutine's block reason to an edge category. The matching is
// substring-based and case-insensitive because reason strings vary across Go
// versions (e.g. "chan receive", "chan send", "sync.Mutex.Lock", "semacquire").
func Classify(reason string) model.EdgeCategory {
	r := strings.ToLower(reason)
	switch {
	case strings.Contains(r, "chan"):
		return model.CategoryChannel
	case strings.Contains(r, "sync"),
		strings.Contains(r, "mutex"),
		strings.Contains(r, "sema"),
		strings.Contains(r, "waitgroup"):
		return model.CategoryMutex
	default:
		return model.CategoryOther
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
go test ./internal/causality/
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/causality/
git commit -m "feat(causality): classify block reasons into edge categories"
```

---

## Task 4: Trace generation test helper and scenarios

This helper lets every parser test produce a real trace in-process, so no binary fixtures need to be committed. It lives in the `parse_test` external test package.

**Files:**
- Create: `internal/parse/testutil_test.go`

- [ ] **Step 1: Write the helper and scenarios**

Create `internal/parse/testutil_test.go`:
```go
package parse_test

import (
	"bytes"
	"io"
	"runtime/trace"
	"sync"
	"testing"
)

// genTrace runs scenario while the execution tracer is active and returns a
// reader over the captured trace bytes.
func genTrace(t *testing.T, scenario func()) io.Reader {
	t.Helper()
	var buf bytes.Buffer
	if err := trace.Start(&buf); err != nil {
		t.Fatalf("trace.Start: %v", err)
	}
	scenario()
	trace.Stop()
	if buf.Len() == 0 {
		t.Fatal("captured trace is empty")
	}
	return bytes.NewReader(buf.Bytes())
}

// scenarioSendRecv: two goroutines rendezvous on an unbuffered channel. One
// side always blocks until the other arrives, guaranteeing a chan block and an
// unblock edge between the two goroutines.
func scenarioSendRecv() {
	ch := make(chan int)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); ch <- 42 }()
	go func() { defer wg.Done(); <-ch }()
	wg.Wait()
}
```

- [ ] **Step 2: Verify it compiles (no test functions yet)**

Run:
```bash
go vet ./internal/parse/
```
Expected: it reports `no Go files` is NOT shown; instead an "undefined: parse" type error is also NOT expected yet because there are no references. If vet reports `no test files to run`-style success or only complains that `genTrace`/`scenarioSendRecv` are unused, that is fine for now — the next task uses them. If unused-symbol errors block the build, proceed to Task 5 which references them.

> Note: Go does not error on unused package-level functions, so this file compiles on its own. `go build ./internal/parse/` will report there is no non-test Go file yet — that is expected; `parse.go` arrives in Task 5.

- [ ] **Step 3: Commit**

```bash
git add internal/parse/testutil_test.go
git commit -m "test(parse): add in-process trace generation helper and send/recv scenario"
```

---

## Task 5: Parser — build goroutine intervals

This task creates the single-pass parser. The event loop it introduces also naturally produces the data later tasks assert on (edges, names), but this task's *test* only pins interval construction.

**Files:**
- Create: `internal/parse/parse.go`
- Test: `internal/parse/parse_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/parse/parse_test.go`:
```go
package parse_test

import (
	"strings"
	"testing"

	"github.com/kenshin579/trace-go/internal/model"
	"github.com/kenshin579/trace-go/internal/parse"
)

func TestParseProducesBlockedChannelInterval(t *testing.T) {
	r := genTrace(t, scenarioSendRecv)
	sum, err := parse.Parse(r)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(sum.Goroutines) == 0 {
		t.Fatal("no goroutines parsed")
	}
	if sum.EndTime <= sum.StartTime {
		t.Fatalf("bad time range: start=%d end=%d", sum.StartTime, sum.EndTime)
	}

	// An unbuffered rendezvous guarantees at least one goroutine blocks on a
	// channel operation.
	foundChanBlock := false
	for _, g := range sum.Goroutines {
		for _, iv := range g.Intervals {
			if iv.End < iv.Start {
				t.Fatalf("interval end before start in g%d: %+v", g.ID, iv)
			}
			if iv.State == model.StateBlocked && strings.Contains(iv.BlockReason, "chan") {
				foundChanBlock = true
			}
		}
	}
	if !foundChanBlock {
		t.Fatal("expected a goroutine blocked on a channel op, found none")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
go test ./internal/parse/ -run TestParseProducesBlockedChannelInterval
```
Expected: FAIL — `undefined: parse.Parse`.

- [ ] **Step 3: Write the implementation**

Create `internal/parse/parse.go`:
```go
// Package parse turns a Go 1.22+ execution trace into a model.TraceSummary in a
// single forward pass over the event stream.
package parse

import (
	"errors"
	"io"
	"sort"

	exptrace "golang.org/x/exp/trace"

	"github.com/kenshin579/trace-go/internal/causality"
	"github.com/kenshin579/trace-go/internal/model"
)

// gobuilder accumulates the in-progress state for one goroutine. openStart and
// the other bookkeeping fields live here (not on model.Goroutine) so they never
// leak into the serialized output.
type gobuilder struct {
	g         model.Goroutine
	created   bool
	hasOpen   bool        // an interval is currently open
	curState  model.State // state of the open interval
	curReason string      // block reason of the open interval (if blocked)
	lastWait  string      // reason of the most recent GoWaiting transition
	openStart model.Time  // start time of the currently open interval
}

func (b *gobuilder) openAt(t model.Time) {
	b.openStart = t
	b.hasOpen = true
}

// Parse reads an execution trace and returns the normalized summary.
func Parse(r io.Reader) (*model.TraceSummary, error) {
	rd, err := exptrace.NewReader(r)
	if err != nil {
		return nil, err
	}

	builders := map[int64]*gobuilder{}
	var edges []model.CausalEdge
	var minT, maxT model.Time
	haveTime := false

	get := func(id int64) *gobuilder {
		b := builders[id]
		if b == nil {
			b = &gobuilder{g: model.Goroutine{ID: id}}
			builders[id] = b
		}
		return b
	}

	for {
		ev, err := rd.ReadEvent()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}

		now := model.Time(ev.Time())
		if !haveTime {
			minT, maxT, haveTime = now, now, true
		} else {
			if now < minT {
				minT = now
			}
			if now > maxT {
				maxT = now
			}
		}

		if ev.Kind() != exptrace.EventStateTransition {
			continue
		}
		st := ev.StateTransition()
		if st.Resource.Kind != exptrace.ResourceGoroutine {
			continue
		}

		id := int64(st.Resource.Goroutine())
		from, to := st.Goroutine()
		b := get(id)

		// Close any open interval at this transition time.
		if b.hasOpen {
			iv := model.Interval{Start: b.openStart, End: now, State: b.curState}
			if b.curState == model.StateBlocked {
				iv.BlockReason = b.curReason
			}
			b.g.Intervals = append(b.g.Intervals, iv)
			b.hasOpen = false
		}

		// Record creation the first time the goroutine leaves a non-existent state.
		if !b.created && (from == exptrace.GoNotExist || from == exptrace.GoUndetermined) {
			b.g.CreatedAt = now
			b.created = true
		}

		// Causal edge: a Waiting -> Runnable transition means the goroutine that
		// executed this event woke up the resource goroutine.
		if from == exptrace.GoWaiting && to == exptrace.GoRunnable {
			unblocker := int64(ev.Goroutine())
			if unblocker != int64(exptrace.NoGoroutine) && unblocker != id {
				edges = append(edges, model.CausalEdge{
					From:     unblocker,
					To:       id,
					Time:     now,
					Category: causality.Classify(b.lastWait),
				})
			}
		}

		// Remember the reason we entered Waiting, for edge classification.
		if to == exptrace.GoWaiting {
			b.lastWait = st.Reason
		}

		// Goroutine ended: record end time, leave no open interval.
		if to == exptrace.GoNotExist {
			b.g.EndedAt = now
			continue
		}

		// Best-effort name: first time we see it running, take the start function.
		if to == exptrace.GoRunning && b.g.Name == "" {
			b.g.Name = startFunc(st.Stack)
		}

		// Open the new interval.
		b.curState, b.curReason = mapState(to, st.Reason)
		b.openAt(now)
	}

	// Close intervals still open at trace end.
	for _, b := range builders {
		if b.hasOpen {
			iv := model.Interval{Start: b.openStart, End: maxT, State: b.curState}
			if b.curState == model.StateBlocked {
				iv.BlockReason = b.curReason
			}
			b.g.Intervals = append(b.g.Intervals, iv)
			b.hasOpen = false
		}
	}

	gs := make([]model.Goroutine, 0, len(builders))
	for _, b := range builders {
		gs = append(gs, b.g)
	}
	sort.Slice(gs, func(i, j int) bool { return gs[i].ID < gs[j].ID })

	return &model.TraceSummary{
		StartTime:  minT,
		EndTime:    maxT,
		Goroutines: gs,
		Edges:      edges,
	}, nil
}

// mapState converts a trace GoState into our display State plus a reason.
func mapState(s exptrace.GoState, reason string) (model.State, string) {
	switch s {
	case exptrace.GoRunning:
		return model.StateRunning, ""
	case exptrace.GoRunnable:
		return model.StateRunnable, ""
	case exptrace.GoWaiting:
		return model.StateBlocked, reason
	case exptrace.GoSyscall:
		return model.StateBlocked, "syscall"
	default:
		return model.StateRunnable, ""
	}
}

// startFunc returns the outermost (start) function of a stack, best-effort.
func startFunc(s exptrace.Stack) string {
	last := ""
	for f := range s.Frames() {
		if f.Func != "" {
			last = f.Func
		}
	}
	return last
}
```

The `gobuilder` struct and its `openAt` method (defined near the top of the file above) hold the interval bookkeeping. The full file is now complete — no further helpers needed.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
go test ./internal/parse/ -run TestParseProducesBlockedChannelInterval
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/parse/parse.go internal/parse/parse_test.go
git commit -m "feat(parse): build goroutine state intervals from trace events"
```

---

## Task 6: Parser — assert causal channel edges

The edge-building code already exists from Task 5. This task adds a test that pins the causal-edge behavior so a future change cannot silently drop it.

**Files:**
- Modify: `internal/parse/parse_test.go` (add one test function)

- [ ] **Step 1: Write the failing test**

Append to `internal/parse/parse_test.go`:
```go
func TestParseProducesChannelCausalEdge(t *testing.T) {
	r := genTrace(t, scenarioSendRecv)
	sum, err := parse.Parse(r)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}

	channelEdges := 0
	for _, e := range sum.Edges {
		if e.From == e.To {
			t.Fatalf("self edge is invalid: %+v", e)
		}
		if e.Category == model.CategoryChannel {
			channelEdges++
		}
	}
	if channelEdges == 0 {
		t.Fatalf("expected at least one channel causal edge, got edges=%+v", sum.Edges)
	}
}
```

- [ ] **Step 2: Run test to verify behavior**

Run:
```bash
go test ./internal/parse/ -run TestParseProducesChannelCausalEdge -v
```
Expected: PASS (the edge logic was implemented in Task 5). If it FAILS with zero channel edges, that is the spec's #1 risk materializing — STOP and inspect with the `tracedump` CLI in Task 8 before continuing; the unblock-causality data may be weaker than expected and the design's graph view would need rethinking.

- [ ] **Step 3: Commit**

```bash
git add internal/parse/parse_test.go
git commit -m "test(parse): pin channel causal edge reconstruction"
```

---

## Task 7: Parser — best-effort goroutine name

The name code already exists from Task 5. This test pins that at least the goroutines we explicitly start get a non-empty name, without asserting an exact (version-dependent) function string.

**Files:**
- Modify: `internal/parse/parse_test.go` (add one test function)

- [ ] **Step 1: Write the test**

Append to `internal/parse/parse_test.go`:
```go
func TestParseAssignsNamesToRunningGoroutines(t *testing.T) {
	r := genTrace(t, scenarioSendRecv)
	sum, err := parse.Parse(r)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}

	named := 0
	for _, g := range sum.Goroutines {
		ranAtSomePoint := false
		for _, iv := range g.Intervals {
			if iv.State == model.StateRunning {
				ranAtSomePoint = true
			}
		}
		if ranAtSomePoint && g.Name != "" {
			named++
		}
	}
	if named == 0 {
		t.Fatal("expected at least one running goroutine to have a name")
	}
}
```

- [ ] **Step 2: Run test to verify it passes**

Run:
```bash
go test ./internal/parse/ -run TestParseAssignsNamesToRunningGoroutines
```
Expected: PASS.

- [ ] **Step 3: Run the full parse package suite**

Run:
```bash
go test ./internal/parse/ -v
```
Expected: all three parse tests PASS.

- [ ] **Step 4: Commit**

```bash
git add internal/parse/parse_test.go
git commit -m "test(parse): pin best-effort goroutine naming"
```

---

## Task 8: tracedump CLI

A thin command that parses a trace file and prints the summary as indented JSON. This is the deliverable that lets us validate real traces before any UI exists.

**Files:**
- Create: `cmd/tracedump/main.go`

- [ ] **Step 1: Write the implementation**

Create `cmd/tracedump/main.go`:
```go
// Command tracedump parses a Go execution trace and prints the normalized
// trace-go summary as indented JSON. Usage: tracedump <trace.out>
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/kenshin579/trace-go/internal/parse"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: tracedump <trace.out>")
		os.Exit(2)
	}
	f, err := os.Open(os.Args[1])
	if err != nil {
		fmt.Fprintf(os.Stderr, "open: %v\n", err)
		os.Exit(1)
	}
	defer f.Close()

	sum, err := parse.Parse(f)
	if err != nil {
		fmt.Fprintf(os.Stderr, "parse: %v\n", err)
		os.Exit(1)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(sum); err != nil {
		fmt.Fprintf(os.Stderr, "encode: %v\n", err)
		os.Exit(1)
	}
}
```

- [ ] **Step 2: Verify it builds**

Run:
```bash
go build ./cmd/tracedump/
```
Expected: produces a `tracedump` binary in the current directory, no errors. (Remove it afterward or rely on `.gitignore`, which already ignores build output.)

- [ ] **Step 3: Generate a real trace fixture to test against**

Create a throwaway program and run it with tracing. Run:
```bash
mkdir -p /tmp/tg && cat > /tmp/tg/main.go <<'GO'
package main

import (
	"os"
	"runtime/trace"
	"sync"
)

func main() {
	f, _ := os.Create("/tmp/tg/trace.out")
	defer f.Close()
	trace.Start(f)
	defer trace.Stop()

	ch := make(chan int)
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); ch <- 1 }()
	}
	go func() {
		for i := 0; i < 5; i++ {
			<-ch
		}
	}()
	wg.Wait()
}
GO
( cd /tmp/tg && go run main.go )
```
Expected: `/tmp/tg/trace.out` exists and is non-empty.

- [ ] **Step 4: Run the CLI against the real trace (risk gate)**

Run:
```bash
go run ./cmd/tracedump/ /tmp/tg/trace.out | head -60
```
Expected: indented JSON with a `goroutines` array (each with `intervals`) and an `edges` array. **Confirm the `edges` array is non-empty and contains at least one `"category": "channel"` entry.** This is the concrete validation of the spec's #1 risk — if edges are present and sensible, the Plan 2 graph view is viable. If `edges` is empty, stop and report findings before starting Plan 2.

- [ ] **Step 5: Commit**

```bash
git add cmd/tracedump/main.go
git commit -m "feat(cmd): add tracedump CLI that prints trace summary as JSON"
```

---

## Task 9: Full suite and module tidy

**Files:**
- Modify: `go.mod`, `go.sum` (via `go mod tidy`)

- [ ] **Step 1: Tidy modules**

Run:
```bash
go mod tidy
```
Expected: `go.mod`/`go.sum` adjusted to exactly the used dependencies.

- [ ] **Step 2: Run the entire test suite**

Run:
```bash
go test ./...
```
Expected: `ok` for `internal/model`, `internal/causality`, `internal/parse`; `cmd/tracedump` reports `no test files` (acceptable — it is exercised by the manual risk gate in Task 8).

- [ ] **Step 3: Vet**

Run:
```bash
go vet ./...
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add go.mod go.sum
git commit -m "chore: go mod tidy"
```

---

## Self-Review Notes

- **Spec coverage:** Data model (spec §3) → Tasks 2. Causality classification + reconstruction (spec §3) → Tasks 3, 5, 6. Parser / phase 1–2 (spec §5) → Tasks 4–7. Risk validation that edges actually appear (spec §7 risk #1) → Tasks 6 Step 2 and 8 Step 4. Testing strategy with generated fixtures and invariant assertions (spec §6) → Tasks 4–7. Go 1.22+ only (spec §1) → Task 1 Step 3 (`go 1.23`) and the use of the new-format reader.
- **Out of scope here (Plan 2):** Wails scaffolding (phase 0), timeline/graph/playback rendering (phases 3–5), `OpenTrace` binding. Intentionally deferred until this plan validates real-trace data shape.
- **Type consistency:** `model.Time`, `model.State`/`State*`, `model.EdgeCategory`/`Category*`, `Interval`, `Goroutine`, `CausalEdge`, `TraceSummary`, `parse.Parse`, `causality.Classify` are used identically across all tasks.
- **Known best-effort behaviors (documented, not bugs):** goroutine `Name` (start function heuristic), edge `Category` (reason-string inference), and the absence of channel identity / transferred values — all consistent with spec §3's stated limits.
