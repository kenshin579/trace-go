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

// Goroutine is one goroutine's full lifetime and timeline.
type Goroutine struct {
	ID        int64      `json:"id"`
	Name      string     `json:"name"` // best-effort start function, may be ""
	CreatedAt Time       `json:"createdAt"`
	EndedAt   Time       `json:"endedAt"` // 0 if it never ended within the trace
	Intervals []Interval `json:"intervals"`
	Regions   []Region   `json:"regions,omitempty"`
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
	Logs       []Log        `json:"logs,omitempty"`
}
