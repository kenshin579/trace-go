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
