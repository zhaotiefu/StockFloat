package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"fyne.io/fyne/v2/test"
)

func TestAddSymbolAndSettingsDefaults(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "StockFloat")
	if err := os.WriteFile(exe, []byte("x"), 0755); err != nil {
		t.Fatal(err)
	}
	// Point data beside a fake exe by chdir — dataPath uses os.Executable which
	// during `go test` points at the test binary, so write beside that instead.
	d := defaultData()
	d.Settings.AlwaysOnTop = false
	d.Settings.EdgeAutoHide = true
	d.Settings.Opacity = 80
	normalizeSettings(&d.Settings)
	if d.Settings.Opacity != 80 {
		t.Fatalf("opacity %d", d.Settings.Opacity)
	}
	if !d.Settings.EdgeAutoHide {
		t.Fatal("edge auto hide")
	}

	ui := &floatUI{data: d, uiPulse: make(chan struct{}, 1)}
	if msg := ui.addSymbol("bad"); msg == "" {
		t.Fatal("expected invalid symbol error")
	}
	if msg := ui.addSymbol("000001"); msg != "" {
		t.Fatalf("add: %s", msg)
	}
	if len(ui.data.Settings.Watchlist) != 5 {
		t.Fatalf("watchlist len %d", len(ui.data.Settings.Watchlist))
	}
	if msg := ui.addSymbol("000001"); msg == "" {
		t.Fatal("expected duplicate error")
	}
}

func TestFloatContentWidgets(t *testing.T) {
	a := test.NewApp()
	defer a.Quit()
	ui := &floatUI{
		app:     a,
		data:    defaultData(),
		uiPulse: make(chan struct{}, 1),
	}
	w := a.NewWindow("Stock Float")
	ui.win = w
	w.SetContent(ui.fullContent())
	ui.rebuildList()

	if ui.clockLbl == nil || ui.refreshLbl == nil {
		t.Fatal("footer labels missing")
	}
	if ui.addEntry == nil || ui.opacitySlide == nil {
		t.Fatal("add/opacity controls missing")
	}
	if ui.listBox == nil || len(ui.listBox.Objects) == 0 {
		t.Fatal("stock list empty")
	}
	// Simulate manual refresh status path without network by setting times
	ui.updatedAt = time.Now()
	ui.rebuildList()
	if ui.refreshLbl.Text == "刷新 --:--:--" {
		t.Fatal("expected refresh timestamp")
	}
	// Toggle always-on-top setting persistence shape
	ui.data.Settings.AlwaysOnTop = true
	ui.applyWindowChrome()
	if ui.topBtn.Text != "置顶✓" {
		t.Fatalf("top btn text %q", ui.topBtn.Text)
	}

	ui.openSettings()
	if ui.settingsWin == nil {
		t.Fatal("settings window not created")
	}
	ui.settingsWin.Close()
}
