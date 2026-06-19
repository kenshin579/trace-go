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

func TestParseMutexScenarioProducesBlockedIntervals(t *testing.T) {
	r := genTrace(t, scenarioMutexContention)
	sum, err := parse.Parse(r)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	blocked := 0
	for _, g := range sum.Goroutines {
		for _, iv := range g.Intervals {
			if iv.State == model.StateBlocked {
				blocked++
			}
		}
	}
	if blocked == 0 {
		t.Fatal("expected at least one blocked interval under mutex contention")
	}
	// Any mutex-categorized edges that DID appear must be well-formed.
	for _, e := range sum.Edges {
		if e.From == e.To {
			t.Fatalf("self edge: %+v", e)
		}
	}
}

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
