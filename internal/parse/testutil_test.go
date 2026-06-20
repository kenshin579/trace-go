package parse_test

import (
	"bytes"
	"context"
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

// scenarioRegionsLogs emits nested user regions and logs on the running goroutine.
func scenarioRegionsLogs() {
	ctx := context.Background()
	trace.Log(ctx, "startup", "begin")
	trace.WithRegion(ctx, "outer", func() {
		trace.WithRegion(ctx, "inner", func() {
			trace.Log(ctx, "work", "step")
		})
	})
}

// scenarioMutexContention: many goroutines contend for a single mutex,
// forcing some to block on sync.Mutex.Lock and be woken by the unlocker.
func scenarioMutexContention() {
	var mu sync.Mutex
	var wg sync.WaitGroup
	counter := 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				mu.Lock()
				counter++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	_ = counter
}
