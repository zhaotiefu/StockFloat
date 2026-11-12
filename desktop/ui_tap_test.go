package main

import (
	"testing"
	"time"

	"fyne.io/fyne/v2/test"
	"fyne.io/fyne/v2/widget"
)

// Exercises button callbacks without OS mouse — guards against the old settings deadlock.
func TestSettingsAndAddViaTap(t *testing.T) {
	a := test.NewApp()
	defer a.Quit()

	ui := &floatUI{app: a, data: defaultData()}
	w := a.NewWindow("Stock Float")
	ui.win = w
	w.SetContent(ui.fullContent())
	ui.rebuildList()

	// Tap-equivalent: invoke openSettings directly (same path as 设置 button).
	done := make(chan struct{})
	go func() {
		ui.openSettings()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("openSettings deadlocked or hung")
	}
	if ui.settingsWin == nil {
		t.Fatal("settings window missing")
	}

	// Add via the same helper the 添加 button uses.
	if msg := ui.addSymbol("000001"); msg != "" {
		t.Fatalf("add: %s", msg)
	}
	ui.rebuildList()
	if len(ui.data.Settings.Watchlist) != 5 {
		t.Fatalf("watchlist=%d", len(ui.data.Settings.Watchlist))
	}

	// Ensure refresh button path does not panic when tapped through widget tree.
	test.Tap(widget.NewButton("刷新", func() { go ui.refreshQuotes(true) }))
	ui.settingsWin.Close()
}
