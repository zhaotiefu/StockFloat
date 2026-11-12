package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestInferBoard(t *testing.T) {
	cases := []struct {
		sym   string
		board string
		ok    bool
	}{
		{"601318", "SH", true},
		{"600519", "SH", true},
		{"500001", "SH", true},
		{"000001", "SZ", true},
		{"300750", "SZ", true},
		{"12345", "", false},
		{"abcdef", "", false},
		{"400001", "", false},
		{"", "", false},
	}
	for _, c := range cases {
		board, ok := inferBoard(c.sym)
		if ok != c.ok || board != c.board {
			t.Fatalf("inferBoard(%q)=(%q,%v) want (%q,%v)", c.sym, board, ok, c.board, c.ok)
		}
	}
}

func TestProviderCode(t *testing.T) {
	got := providerCode(WatchStock{Symbol: "601318", Board: "SH"})
	if got != "sh601318" {
		t.Fatalf("got %q", got)
	}
	got = providerCode(WatchStock{Symbol: "300750", Board: "SZ"})
	if got != "sz300750" {
		t.Fatalf("got %q", got)
	}
}

func TestParseFields(t *testing.T) {
	fields := make([]string, 40)
	fields[1] = "中国平安"
	fields[3] = "53.33"
	fields[4] = "53.41"
	fields[32] = "-0.15"
	q := parseFields("601318", fields)
	if q.Name != "中国平安" || !q.HasPrice || q.Price != 53.33 || !q.HasChange || q.ChangePercent != -0.15 {
		t.Fatalf("unexpected quote: %+v", q)
	}

	fields2 := make([]string, 10)
	fields2[1] = "测试"
	fields2[3] = "10.00"
	fields2[4] = "8.00"
	q2 := parseFields("000001", fields2)
	if !q2.HasChange || q2.ChangePercent < 24.9 || q2.ChangePercent > 25.1 {
		t.Fatalf("fallback change percent failed: %+v", q2)
	}
}

func TestDefaultData(t *testing.T) {
	d := defaultData()
	if !d.Settings.Enabled || d.Settings.RefreshInterval != 2 {
		t.Fatalf("bad defaults: %+v", d.Settings)
	}
	if len(d.Settings.Watchlist) != 4 {
		t.Fatalf("expected 4 default stocks, got %d", len(d.Settings.Watchlist))
	}
}

func TestSaveLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "stockfloat-data.json")
	orig := dataPath
	dataPath = func() string { return path }
	t.Cleanup(func() { dataPath = orig })

	in := defaultData()
	in.Settings.RefreshInterval = 5
	in.Settings.ShowSymbol = true
	in.Settings.Watchlist = []WatchStock{{Symbol: "601318", Name: "中国平安", Board: "SH"}}
	if err := saveData(in); err != nil {
		t.Fatal(err)
	}
	out := loadData()
	if out.Settings.RefreshInterval != 5 || !out.Settings.ShowSymbol {
		t.Fatalf("loaded settings mismatch: %+v", out.Settings)
	}
	if len(out.Settings.Watchlist) != 1 || out.Settings.Watchlist[0].Symbol != "601318" {
		t.Fatalf("loaded watchlist mismatch: %+v", out.Settings.Watchlist)
	}
}

func TestLoadDataCorruptFallsBack(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "stockfloat-data.json")
	if err := os.WriteFile(path, []byte("{not-json"), 0644); err != nil {
		t.Fatal(err)
	}
	orig := dataPath
	dataPath = func() string { return path }
	t.Cleanup(func() { dataPath = orig })
	out := loadData()
	if len(out.Settings.Watchlist) == 0 {
		t.Fatal("expected default watchlist on corrupt file")
	}
}

func TestFetchQuotesLive(t *testing.T) {
	stocks := []WatchStock{
		{Symbol: "601318", Name: "中国平安", Board: "SH"},
		{Symbol: "300750", Name: "宁德时代", Board: "SZ"},
	}
	qs, err := fetchQuotes(stocks)
	if err != nil {
		t.Fatalf("fetchQuotes: %v", err)
	}
	if len(qs) != 2 {
		t.Fatalf("want 2 quotes, got %d", len(qs))
	}
	for _, q := range qs {
		if !q.HasPrice {
			t.Fatalf("missing price for %s: %+v", q.Symbol, q)
		}
		if q.Name == "" {
			t.Fatalf("missing name for %s", q.Symbol)
		}
		t.Logf("%s %s %.2f %.2f%%", q.Symbol, q.Name, q.Price, q.ChangePercent)
	}
}

func TestRemoveSymbol(t *testing.T) {
	in := []WatchStock{
		{Symbol: "601318", Board: "SH"},
		{Symbol: "300750", Board: "SZ"},
		{Symbol: "000001", Board: "SZ"},
	}
	out := removeSymbol(in, "300750")
	if len(out) != 2 || out[0].Symbol != "601318" || out[1].Symbol != "000001" {
		t.Fatalf("unexpected: %+v", out)
	}
	out = removeSymbol(in, "nope")
	if len(out) != 3 {
		t.Fatalf("expected unchanged len 3, got %d", len(out))
	}
}

func TestJSONSchemaStable(t *testing.T) {
	raw, err := json.Marshal(defaultData())
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	settings, ok := m["settings"].(map[string]any)
	if !ok {
		t.Fatal("missing settings")
	}
	for _, k := range []string{"enabled", "refreshInterval", "showSymbol", "watchlist"} {
		if _, ok := settings[k]; !ok {
			t.Fatalf("missing key %s", k)
		}
	}
}
