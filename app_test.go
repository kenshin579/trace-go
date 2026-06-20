package main

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime/trace"
	"strings"
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
	_, err := app.OpenTrace("/no/such/trace.out")
	if err == nil {
		t.Fatal("expected an error opening a missing file")
	}
	if got := err.Error(); got != "Can't find that file — it may have been moved or deleted." {
		t.Fatalf("unfriendly missing-file error: %q", got)
	}
}

func TestOpenTraceNotATraceErrors(t *testing.T) {
	app := NewApp()
	path := filepath.Join(t.TempDir(), "garbage.out")
	if err := os.WriteFile(path, []byte("not a trace"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	_, err := app.OpenTrace(path)
	if err == nil {
		t.Fatal("expected an error opening a non-trace file")
	}
	if !strings.Contains(err.Error(), "isn't a Go execution trace") {
		t.Fatalf("unfriendly not-a-trace error: %q", err.Error())
	}
}
