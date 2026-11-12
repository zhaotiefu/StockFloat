package main

import "testing"

func TestInferBoard(t *testing.T) {
	cases := []struct {
		sym   string
		board string
		ok    bool
	}{
		{"601318", "SH", true},
		{"600519", "SH", true},
		{"000001", "SZ", true},
		{"300750", "SZ", true},
		{"123", "", false},
		{"abcdef", "", false},
	}
	for _, c := range cases {
		b, ok := inferBoard(c.sym)
		if ok != c.ok || b != c.board {
			t.Fatalf("inferBoard(%s)=%s,%v want %s,%v", c.sym, b, ok, c.board, c.ok)
		}
	}
}

func TestNormalizeSettings(t *testing.T) {
	s := Settings{RefreshInterval: 0, Opacity: 0}
	normalizeSettings(&s)
	if s.RefreshInterval != 2 {
		t.Fatalf("interval=%d", s.RefreshInterval)
	}
	if s.Opacity != 100 {
		t.Fatalf("opacity=%d", s.Opacity)
	}
	s2 := Settings{Opacity: 0}
	normalizeSettings(&s2)
	if s2.Opacity != 100 {
		t.Fatalf("opacity default=%d", s2.Opacity)
	}
	s3 := Settings{Opacity: 1}
	normalizeSettings(&s3)
	if s3.Opacity != 1 {
		t.Fatalf("opacity min=%d", s3.Opacity)
	}
	if len(s.Watchlist) == 0 {
		t.Fatal("expected default watchlist")
	}
}

func TestMoveStockSwap(t *testing.T) {
	ui := &floatUI{data: defaultData()}
	a, b := ui.data.Settings.Watchlist[0].Symbol, ui.data.Settings.Watchlist[1].Symbol
	if !ui.moveStock(0, 1) {
		t.Fatal("swap failed")
	}
	if ui.data.Settings.Watchlist[0].Symbol != b || ui.data.Settings.Watchlist[1].Symbol != a {
		t.Fatalf("order=%v", ui.data.Settings.Watchlist)
	}
}

func TestParseFields(t *testing.T) {
	fields := make([]string, 40)
	fields[1] = "测试股票"
	fields[3] = "10.50"
	fields[4] = "10.00"
	fields[32] = "5.00"
	q := parseFields("601318", fields)
	if !q.HasPrice || q.Price != 10.5 {
		t.Fatalf("price=%v", q.Price)
	}
	if !q.HasChange || q.ChangePercent != 5 {
		t.Fatalf("chg=%v", q.ChangePercent)
	}
}
