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

		// Best-effort name: on goroutine creation (NotExist/Undetermined → *) the
		// state-transition stack holds the goroutine's start function. Falling back
		// to GoRunning captures it for goroutines whose creation we missed, though
		// in practice GoRunning transitions carry an empty stack in Go 1.22+ traces.
		if b.g.Name == "" {
			if from == exptrace.GoNotExist || from == exptrace.GoUndetermined {
				b.g.Name = startFunc(st.Stack)
			} else if to == exptrace.GoRunning {
				b.g.Name = startFunc(st.Stack)
			}
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
		// The trace records a per-syscall reason, but we collapse all syscalls to
		// a single "syscall" label so that the UI groups them consistently.
		return model.StateBlocked, "syscall"
	default:
		// GoNotExist and any future GoStates added by the runtime are treated as
		// Runnable so they never silently drop from the timeline.
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
