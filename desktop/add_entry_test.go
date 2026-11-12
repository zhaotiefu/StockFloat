
package main

import (
	"testing"

	"fyne.io/fyne/v2/test"
)

func TestAddFromEntryWidget(t *testing.T) {
	a := test.NewApp()
	defer a.Quit()
	ui := &floatUI{app: a, data: defaultData()}
	w := a.NewWindow("t")
	ui.win = w
	w.SetContent(ui.fullContent())
	ui.addEntry.SetText("000001")
	msg := ui.addSymbol(ui.addEntry.Text)
	if msg != "" {
		t.Fatalf("msg=%q", msg)
	}
	ui.rebuildList()
	if len(ui.data.Settings.Watchlist) != 5 {
		t.Fatalf("len=%d", len(ui.data.Settings.Watchlist))
	}
	found := false
	for _, s := range ui.data.Settings.Watchlist {
		if s.Symbol == "000001" && s.Board == "SZ" {
			found = true
		}
	}
	if !found {
		t.Fatal("000001 not in list")
	}
}
