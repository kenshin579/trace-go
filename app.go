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
