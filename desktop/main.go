package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image/color"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/driver/desktop"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

const (
	appID    = "com.stockfloat.portable"
	maxWatch = 20
	appTitle = "Stock Float"
	quoteURL = "https://qt.gtimg.cn/q="
	edgePx   = 10
	peekPx   = 8
)

type WatchStock struct {
	Symbol string `json:"symbol"`
	Name   string `json:"name"`
	Board  string `json:"board"`
}

type Settings struct {
	Enabled         bool         `json:"enabled"`
	RefreshInterval int          `json:"refreshInterval"`
	ShowSymbol      bool         `json:"showSymbol"`
	AlwaysOnTop     bool         `json:"alwaysOnTop"`
	EdgeAutoHide    bool         `json:"edgeAutoHide"`
	Opacity         int          `json:"opacity"`
	ChromeHidden    bool         `json:"chromeHidden"`
	RowGap          int          `json:"rowGap"` // 0=紧凑 1=适中 2=宽松
	Watchlist       []WatchStock `json:"watchlist"`
}

type Quote struct {
	Symbol        string
	Name          string
	Price         float64
	ChangePercent float64
	HasPrice      bool
	HasChange     bool
}

type AppData struct {
	Settings Settings `json:"settings"`
}

func defaultData() AppData {
	return AppData{
		Settings: Settings{
			Enabled:         true,
			RefreshInterval: 2,
			ShowSymbol:      false,
			AlwaysOnTop:     true,
			EdgeAutoHide:    false,
			Opacity:         100,
			ChromeHidden:    false,
			RowGap:          0,
			Watchlist: []WatchStock{
				{Symbol: "601318", Name: "中国平安", Board: "SH"},
				{Symbol: "600519", Name: "贵州茅台", Board: "SH"},
				{Symbol: "600036", Name: "招商银行", Board: "SH"},
				{Symbol: "300750", Name: "宁德时代", Board: "SZ"},
			},
		},
	}
}

func normalizeSettings(s *Settings) {
	if s.RefreshInterval <= 0 {
		s.RefreshInterval = 2
	}
	if s.Opacity == 0 {
		s.Opacity = 100
	} else if s.Opacity < 1 {
		s.Opacity = 1
	} else if s.Opacity > 100 {
		s.Opacity = 100
	}
	if s.RowGap < 0 {
		s.RowGap = 0
	}
	if s.RowGap > 2 {
		s.RowGap = 0 // default tighter layout
	}
	if len(s.Watchlist) == 0 {
		s.Watchlist = defaultData().Settings.Watchlist
	}
}

func dataPath() string {
	exe, err := os.Executable()
	if err != nil {
		return "stockfloat-data.json"
	}
	return filepath.Join(filepath.Dir(exe), "stockfloat-data.json")
}

func loadData() AppData {
	b, err := os.ReadFile(dataPath())
	if err != nil {
		d := defaultData()
		_ = saveData(d)
		return d
	}
	var d AppData
	if err := json.Unmarshal(b, &d); err != nil {
		return defaultData()
	}
	normalizeSettings(&d.Settings)
	return d
}

func saveData(d AppData) error {
	normalizeSettings(&d.Settings)
	b, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(dataPath(), b, 0644)
}

func inferBoard(symbol string) (string, bool) {
	if matched, _ := regexp.MatchString(`^\d{6}$`, symbol); !matched {
		return "", false
	}
	if strings.HasPrefix(symbol, "6") || strings.HasPrefix(symbol, "5") {
		return "SH", true
	}
	if strings.HasPrefix(symbol, "0") || strings.HasPrefix(symbol, "3") {
		return "SZ", true
	}
	return "", false
}

func providerCode(s WatchStock) string {
	return strings.ToLower(s.Board) + s.Symbol
}

func decodeGBK(b []byte) string {
	out, err := io.ReadAll(transform.NewReader(bytes.NewReader(b), simplifiedchinese.GBK.NewDecoder()))
	if err != nil || len(out) == 0 {
		return string(b)
	}
	if !utf8.Valid(out) {
		return string(b)
	}
	return string(out)
}

func fetchQuotes(stocks []WatchStock) ([]Quote, error) {
	if len(stocks) == 0 {
		return nil, nil
	}
	codes := make([]string, 0, len(stocks))
	for _, s := range stocks {
		codes = append(codes, providerCode(s))
	}
	req, err := http.NewRequest(http.MethodGet, quoteURL+strings.Join(codes, ","), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 StockFloatPortable")
	client := &http.Client{Timeout: 8 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	text := decodeGBK(raw)
	bySymbol := map[string]Quote{}
	for _, line := range strings.Split(text, ";") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.Contains(line, `="`) {
			continue
		}
		parts := strings.SplitN(line, `="`, 2)
		if len(parts) != 2 {
			continue
		}
		head := strings.TrimPrefix(parts[0], "v_")
		if len(head) < 8 {
			continue
		}
		symbol := head[2:8]
		body := strings.TrimSuffix(parts[1], `"`)
		fields := strings.Split(body, "~")
		if len(fields) < 5 {
			continue
		}
		bySymbol[symbol] = parseFields(symbol, fields)
	}

	out := make([]Quote, 0, len(stocks))
	for _, s := range stocks {
		if q, ok := bySymbol[s.Symbol]; ok {
			if q.Name == "" {
				q.Name = s.Name
			}
			out = append(out, q)
		} else {
			out = append(out, Quote{Symbol: s.Symbol, Name: s.Name})
		}
	}
	return out, nil
}

func parseFields(symbol string, fields []string) Quote {
	q := Quote{Symbol: symbol, Name: strings.TrimSpace(fields[1])}
	if p, err := strconv.ParseFloat(fields[3], 64); err == nil {
		q.Price = p
		q.HasPrice = true
	}
	if len(fields) > 32 {
		if c, err := strconv.ParseFloat(fields[32], 64); err == nil {
			q.ChangePercent = c
			q.HasChange = true
		}
	}
	if !q.HasChange && q.HasPrice {
		if pre, err := strconv.ParseFloat(fields[4], 64); err == nil && pre != 0 {
			q.ChangePercent = (q.Price - pre) / pre * 100
			q.HasChange = true
		}
	}
	return q
}

type lightTheme struct{}

func (lightTheme) Color(n fyne.ThemeColorName, v fyne.ThemeVariant) color.Color {
	switch n {
	case theme.ColorNameBackground:
		return color.NRGBA{R: 255, G: 255, B: 255, A: 255}
	case theme.ColorNameButton:
		return color.NRGBA{R: 226, G: 232, B: 240, A: 255}
	case theme.ColorNameForeground:
		return color.NRGBA{R: 31, G: 41, B: 55, A: 255}
	case theme.ColorNamePlaceHolder:
		return color.NRGBA{R: 107, G: 114, B: 128, A: 255}
	case theme.ColorNamePrimary:
		return color.NRGBA{R: 15, G: 118, B: 110, A: 255}
	case theme.ColorNameHover:
		return color.NRGBA{R: 240, G: 253, B: 250, A: 255}
	case theme.ColorNameInputBackground:
		return color.NRGBA{R: 248, G: 250, B: 252, A: 255}
	case theme.ColorNameMenuBackground, theme.ColorNameOverlayBackground:
		return color.NRGBA{R: 255, G: 255, B: 255, A: 255}
	case theme.ColorNameShadow:
		return color.NRGBA{R: 15, G: 23, B: 42, A: 40}
	default:
		return theme.DefaultTheme().Color(n, theme.VariantLight)
	}
}
func (lightTheme) Font(s fyne.TextStyle) fyne.Resource     { return theme.DefaultTheme().Font(s) }
func (lightTheme) Icon(n fyne.ThemeIconName) fyne.Resource { return theme.DefaultTheme().Icon(n) }
func (lightTheme) Size(n fyne.ThemeSizeName) float32       { return theme.DefaultTheme().Size(n) }

// darkFloatTheme is used only while simplified float mode is active.
type darkFloatTheme struct{ lightTheme }

func (darkFloatTheme) Color(n fyne.ThemeColorName, v fyne.ThemeVariant) color.Color {
	switch n {
	case theme.ColorNameBackground:
		return color.NRGBA{R: 42, G: 46, B: 54, A: 255}
	case theme.ColorNameForeground:
		return color.NRGBA{R: 241, G: 245, B: 249, A: 255}
	case theme.ColorNamePlaceHolder, theme.ColorNameDisabled:
		return color.NRGBA{R: 148, G: 163, B: 184, A: 255}
	case theme.ColorNameButton, theme.ColorNameInputBackground:
		return color.NRGBA{R: 55, G: 60, B: 70, A: 255}
	case theme.ColorNameHover:
		return color.NRGBA{R: 70, G: 76, B: 88, A: 255}
	case theme.ColorNamePrimary:
		return color.NRGBA{R: 94, G: 234, B: 212, A: 255}
	case theme.ColorNameShadow:
		return color.NRGBA{R: 0, G: 0, B: 0, A: 80}
	default:
		return (lightTheme{}).Color(n, v)
	}
}

type edgeDock struct {
	hidden bool
	edge   string
	fullX  int
	fullY  int
	fullW  int
	fullH  int
	nearAt time.Time
}

type floatUI struct {
	mu           sync.Mutex
	data         AppData
	quotes       []Quote
	lastErr      string
	updatedAt    time.Time
	app          fyne.App
	win          fyne.Window
	listBox      *fyne.Container
	chromeBox    *fyne.Container
	chromeBtn    *widget.Button
	clockLbl     *widget.Label
	refreshLbl   *widget.Label
	statusLbl    *widget.Label
	addEntry     *widget.Entry
	addErrLbl    *widget.Label
	opacitySlide *widget.Slider
	topBtn       *widget.Button
	minimized    bool
	settingsWin  fyne.Window
	dock         edgeDock
	refreshBusy  bool
}

func (f *floatUI) requestUI() {
	fyne.Do(func() {
		f.rebuildList()
	})
}

func cstNow() time.Time {
	return time.Now().In(time.FixedZone("CST", 8*3600))
}

func (f *floatUI) applyWindowChrome() {
	fyne.Do(func() {
		f.mu.Lock()
		onTop := f.data.Settings.AlwaysOnTop
		opacity := f.data.Settings.Opacity
		f.mu.Unlock()
		setFrameless(f.win)
		setAlwaysOnTop(f.win, onTop)
		setWindowOpacity(f.win, opacity)
		if f.topBtn != nil {
			if onTop {
				f.topBtn.SetText("置顶✓")
			} else {
				f.topBtn.SetText("置顶")
			}
		}
	})
}

func (f *floatUI) moveStock(from, to int) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := len(f.data.Settings.Watchlist)
	if from < 0 || to < 0 || from >= n || to >= n || from == to {
		return false
	}
	f.data.Settings.Watchlist[from], f.data.Settings.Watchlist[to] = f.data.Settings.Watchlist[to], f.data.Settings.Watchlist[from]
	_ = saveData(f.data)
	if f.listBox != nil && from < len(f.listBox.Objects) && to < len(f.listBox.Objects) {
		f.listBox.Objects[from], f.listBox.Objects[to] = f.listBox.Objects[to], f.listBox.Objects[from]
		if a, ok := f.listBox.Objects[from].(*stockDragRow); ok {
			a.index = from
		}
		if b, ok := f.listBox.Objects[to].(*stockDragRow); ok {
			b.index = to
		}
		f.listBox.Refresh()
	}
	return true
}

func (f *floatUI) rebuildList() {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.listBox == nil {
		return
	}
	items := []fyne.CanvasObject{}
	qmap := map[string]Quote{}
	for _, q := range f.quotes {
		qmap[q.Symbol] = q
	}
	if len(f.data.Settings.Watchlist) == 0 {
		items = append(items, widget.NewLabel("尚未添加自选股票"))
	}
	for i, s := range f.data.Settings.Watchlist {
		q := qmap[s.Symbol]
		name := s.Name
		if q.Name != "" {
			name = q.Name
		}
		leftText := name
		if f.data.Settings.ShowSymbol {
			leftText = fmt.Sprintf("%s %s", name, s.Symbol)
		}
		price := "--"
		if q.HasPrice {
			price = fmt.Sprintf("%.2f", q.Price)
		}
		chg := "--"
		chgColor := color.NRGBA{R: 107, G: 114, B: 128, A: 255}
		if q.HasChange {
			sign := ""
			if q.ChangePercent > 0 {
				sign = "+"
				chgColor = color.NRGBA{R: 225, G: 29, B: 72, A: 255}
			} else if q.ChangePercent < 0 {
				chgColor = color.NRGBA{R: 5, G: 150, B: 105, A: 255}
			}
			chg = fmt.Sprintf("%s%.2f%%", sign, q.ChangePercent)
		}
		simple := f.data.Settings.ChromeHidden
		nameColor := color.NRGBA{R: 31, G: 41, B: 55, A: 255}
		priceColor := color.NRGBA{R: 51, G: 65, B: 85, A: 255}
		if simple {
			nameColor = color.NRGBA{R: 240, G: 244, B: 248, A: 255}
			priceColor = color.NRGBA{R: 226, G: 232, B: 240, A: 255}
		}
		nameLbl := canvas.NewText(leftText, nameColor)
		nameLbl.TextSize = 12
		priceLbl := canvas.NewText(price, priceColor)
		priceLbl.TextSize = 12
		priceLbl.Alignment = fyne.TextAlignTrailing
		chgLbl := canvas.NewText(chg, chgColor)
		chgLbl.TextSize = 12
		chgLbl.TextStyle = fyne.TextStyle{Bold: true}
		chgLbl.Alignment = fyne.TextAlignTrailing
		// 3-column tight row: name | price | change%
		right := container.NewHBox(priceLbl, widget.NewLabel("  "), chgLbl)
		row := container.NewBorder(nil, nil, nameLbl, right)
		items = append(items, newStockDragRow(f, i, row))
	}
	f.listBox.Objects = items
	f.listBox.Refresh()

	if f.clockLbl != nil {
		f.clockLbl.SetText(cstNow().Format("15:04:05"))
	}
	if f.refreshLbl != nil {
		if f.data.Settings.ChromeHidden {
			// simple mode footer uses status as market state
		} else if f.lastErr != "" {
			f.refreshLbl.SetText("刷新失败")
		} else if f.updatedAt.IsZero() {
			f.refreshLbl.SetText("刷新 --:--:--")
		} else {
			f.refreshLbl.SetText("刷新 " + f.updatedAt.In(time.FixedZone("CST", 8*3600)).Format("15:04:05"))
		}
	}
	if f.statusLbl != nil && !f.refreshBusy {
		if f.data.Settings.ChromeHidden {
			f.statusLbl.SetText(marketStatusText())
		} else if f.lastErr != "" {
			f.statusLbl.SetText("异常")
		} else {
			f.statusLbl.SetText("自动刷新")
		}
	}
}

func (f *floatUI) applyModeContent() {
	f.mu.Lock()
	hidden := f.data.Settings.ChromeHidden
	n := len(f.data.Settings.Watchlist)
	f.mu.Unlock()
	if n < 1 {
		n = 1
	}
	if hidden {
		f.app.Settings().SetTheme(&darkFloatTheme{})
		f.win.Resize(fyne.NewSize(268, float32(64+n*22)))
		f.win.SetContent(f.simpleContent())
	} else {
		f.app.Settings().SetTheme(&lightTheme{})
		f.win.Resize(fyne.NewSize(300, 420))
		f.win.SetContent(f.fullContent())
	}
	f.rebuildList()
	f.applyWindowChrome()
}

func (f *floatUI) toggleChrome() {
	f.mu.Lock()
	f.data.Settings.ChromeHidden = !f.data.Settings.ChromeHidden
	_ = saveData(f.data)
	f.mu.Unlock()
	f.applyModeContent()
}

func marketStatusText() string {
	now := cstNow()
	if now.Weekday() == time.Saturday || now.Weekday() == time.Sunday {
		return "已收盘"
	}
	hm := now.Hour()*100 + now.Minute()
	if (hm >= 930 && hm <= 1130) || (hm >= 1300 && hm <= 1500) {
		return "交易中"
	}
	return "已收盘"
}

func (f *floatUI) refreshQuotes(manual bool) {
	f.mu.Lock()
	if f.refreshBusy {
		f.mu.Unlock()
		return
	}
	f.refreshBusy = true
	watch := append([]WatchStock{}, f.data.Settings.Watchlist...)
	f.mu.Unlock()

	if manual {
		fyne.Do(func() {
			if f.statusLbl != nil {
				f.statusLbl.SetText("刷新中…")
			}
		})
	}

	qs, err := fetchQuotes(watch)

	f.mu.Lock()
	if err != nil {
		f.lastErr = err.Error()
	} else {
		f.quotes = qs
		f.lastErr = ""
		f.updatedAt = time.Now()
		for i := range f.data.Settings.Watchlist {
			for _, q := range qs {
				if q.Symbol == f.data.Settings.Watchlist[i].Symbol && q.Name != "" {
					f.data.Settings.Watchlist[i].Name = q.Name
				}
			}
		}
		_ = saveData(f.data)
	}
	f.refreshBusy = false
	f.mu.Unlock()

	fyne.Do(func() {
		if manual && f.statusLbl != nil {
			if err != nil {
				f.statusLbl.SetText("刷新失败")
			} else {
				f.statusLbl.SetText("已刷新")
			}
		}
		f.rebuildList()
	})
}

func (f *floatUI) addSymbol(sym string) string {
	sym = strings.TrimSpace(sym)
	board, ok := inferBoard(sym)
	if !ok {
		return "请输入合法 6 位 A 股代码"
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, s := range f.data.Settings.Watchlist {
		if s.Symbol == sym {
			return "该股票已在自选列表中"
		}
	}
	if len(f.data.Settings.Watchlist) >= maxWatch {
		return fmt.Sprintf("自选最多 %d 只", maxWatch)
	}
	f.data.Settings.Watchlist = append(f.data.Settings.Watchlist, WatchStock{Symbol: sym, Name: sym, Board: board})
	_ = saveData(f.data)
	return ""
}

func (f *floatUI) setMinimized(v bool) {
	f.minimized = v
	if v {
		f.win.Resize(fyne.NewSize(180, 44))
		f.win.SetContent(container.NewPadded(widget.NewButton("STOCK  点击恢复", func() {
			f.setMinimized(false)
		})))
	} else {
		f.applyModeContent()
	}
}

func (f *floatUI) simpleContent() fyne.CanvasObject {
	bg := canvas.NewRectangle(color.NRGBA{R: 42, G: 46, B: 54, A: 250})

	brand := canvas.NewText("STOCK FLOAT", color.NRGBA{R: 248, G: 250, B: 252, A: 255})
	brand.TextSize = 11
	brand.TextStyle = fyne.TextStyle{Bold: true}
	brandBtn := widget.NewButton("", func() {
		// Click brand to leave simplified mode.
		f.mu.Lock()
		f.data.Settings.ChromeHidden = false
		_ = saveData(f.data)
		f.mu.Unlock()
		f.applyModeContent()
	})
	brandBtn.Importance = widget.LowImportance
	brandWrap := container.NewStack(brandBtn, container.NewPadded(brand))

	btnSettings := widget.NewButtonWithIcon("", theme.SettingsIcon(), func() { f.openSettings() })
	btnMin := widget.NewButton("─", func() { f.setMinimized(true) })
	btnHide := widget.NewButton("×", func() {
		f.win.Hide()
		f.mu.Lock()
		f.data.Settings.Enabled = false
		_ = saveData(f.data)
		f.mu.Unlock()
	})
	for _, b := range []*widget.Button{btnSettings, btnMin, btnHide} {
		b.Importance = widget.LowImportance
	}
	header := container.NewBorder(nil, nil,
		newDragHandle(f.win, brandWrap),
		container.NewHBox(btnSettings, btnMin, btnHide),
	)

	f.listBox = container.New(&tightList{})
	listPad := container.NewPadded(f.listBox)

	f.clockLbl = widget.NewLabel(cstNow().Format("15:04:05"))
	f.clockLbl.Importance = widget.LowImportance
	f.statusLbl = widget.NewLabel(marketStatusText())
	f.statusLbl.Importance = widget.LowImportance
	f.refreshLbl = widget.NewLabel("") // unused in simple footer
	btnRefresh := widget.NewButton("刷新", func() { go f.refreshQuotes(true) })
	btnRefresh.Importance = widget.LowImportance
	footer := container.NewBorder(nil, nil, f.clockLbl, container.NewHBox(f.statusLbl, btnRefresh))

	body := container.NewBorder(container.NewPadded(header), container.NewPadded(footer), nil, nil, listPad)
	return container.NewStack(bg, body)
}

func (f *floatUI) fullContent() fyne.CanvasObject {
	btnSettings := widget.NewButton("设置", func() { f.openSettings() })
	btnRefresh := widget.NewButton("刷新", func() { go f.refreshQuotes(true) })
	f.topBtn = widget.NewButton("置顶", func() {
		f.mu.Lock()
		f.data.Settings.AlwaysOnTop = !f.data.Settings.AlwaysOnTop
		on := f.data.Settings.AlwaysOnTop
		_ = saveData(f.data)
		f.mu.Unlock()
		setAlwaysOnTop(f.win, on)
		if on {
			f.topBtn.SetText("置顶✓")
		} else {
			f.topBtn.SetText("置顶")
		}
	})
	f.mu.Lock()
	if f.data.Settings.AlwaysOnTop {
		f.topBtn.SetText("置顶✓")
	}
	f.mu.Unlock()

	btnMin := widget.NewButton("收起", func() { f.setMinimized(true) })
	btnHide := widget.NewButton("×", func() {
		f.win.Hide()
		f.mu.Lock()
		f.data.Settings.Enabled = false
		_ = saveData(f.data)
		f.mu.Unlock()
	})
	f.chromeBtn = widget.NewButton("精简", func() { f.toggleChrome() })

	// No OS title bar / no brand title text. Drag the left strip to move window.
	dragHint := canvas.NewText("≡", color.NRGBA{R: 148, G: 163, B: 184, A: 255})
	dragHint.TextSize = 16
	headerBtns := container.NewHBox(f.chromeBtn, btnMin, btnHide)
	titleRow := container.NewBorder(nil, nil, newDragHandle(f.win, container.NewPadded(dragHint)), headerBtns)
	actionRow := container.NewGridWithColumns(3, btnRefresh, f.topBtn, btnSettings)

	f.listBox = container.New(&tightList{})
	scroll := container.NewVScroll(f.listBox)
	scroll.SetMinSize(fyne.NewSize(260, 90))

	f.addEntry = widget.NewEntry()
	f.addEntry.SetPlaceHolder("代码后回车/点添加")
	f.addErrLbl = widget.NewLabel("")
	f.addErrLbl.Hide()
	doAdd := func() {
		sym := strings.TrimSpace(f.addEntry.Text)
		if sym == "" {
			f.addErrLbl.SetText("请先输入 6 位股票代码")
			f.addErrLbl.Show()
			f.addErrLbl.Refresh()
			return
		}
		msg := f.addSymbol(sym)
		if msg != "" {
			f.addErrLbl.SetText(msg)
			f.addErrLbl.Show()
			f.addErrLbl.Refresh()
			return
		}
		f.addErrLbl.SetText("已添加 " + sym)
		f.addErrLbl.Show()
		f.addErrLbl.Refresh()
		f.addEntry.SetText("")
		f.rebuildList()
		if f.statusLbl != nil {
			f.statusLbl.SetText("已添加")
		}
		go f.refreshQuotes(true)
	}
	f.addEntry.OnSubmitted = func(string) { doAdd() }
	addBtn := widget.NewButton("添加股票", doAdd)
	addBtn.Importance = widget.HighImportance
	addRow := container.NewBorder(nil, nil, nil, addBtn, f.addEntry)

	f.mu.Lock()
	op := float64(f.data.Settings.Opacity)
	f.mu.Unlock()
	f.opacitySlide = widget.NewSlider(1, 100)
	f.opacitySlide.Step = 1
	f.opacitySlide.SetValue(op)
	opacityLbl := widget.NewLabel(fmt.Sprintf("%d%%", int(op)))
	f.opacitySlide.OnChanged = func(v float64) {
		pct := int(v)
		if pct < 1 {
			pct = 1
		}
		opacityLbl.SetText(fmt.Sprintf("%d%%", pct))
		f.mu.Lock()
		f.data.Settings.Opacity = pct
		_ = saveData(f.data)
		f.mu.Unlock()
		setWindowOpacity(f.win, pct)
	}
	opacityRow := container.NewBorder(nil, nil, widget.NewLabel("透明"), opacityLbl, f.opacitySlide)

	f.clockLbl = widget.NewLabel(cstNow().Format("15:04:05"))
	f.refreshLbl = widget.NewLabel("刷新 --:--:--")
	f.statusLbl = widget.NewLabel("自动刷新")
	footerLeft := container.NewHBox(f.clockLbl, widget.NewLabel("   "), f.refreshLbl)
	footer := container.NewBorder(nil, nil, footerLeft, f.statusLbl)

	f.chromeBox = container.NewVBox(actionRow, addRow, f.addErrLbl, opacityRow)

	top := container.NewVBox(titleRow, f.chromeBox)
	return container.NewBorder(
		top,
		footer,
		nil, nil, scroll,
	)
}

func (f *floatUI) openSettings() {
	if f.settingsWin != nil {
		f.settingsWin.Show()
		f.settingsWin.RequestFocus()
		fyne.Do(func() { setAlwaysOnTop(f.settingsWin, true) })
		return
	}
	w := f.app.NewWindow("Stock Float 设置")
	f.settingsWin = w
	w.Resize(fyne.NewSize(420, 620))

	symbolEntry := widget.NewEntry()
	symbolEntry.SetPlaceHolder("输入 6 位代码，如 601318")
	errLbl := widget.NewLabel("")
	errLbl.Hide()

	var watchList *widget.List
	watchList = widget.NewList(
		func() int {
			f.mu.Lock()
			defer f.mu.Unlock()
			return len(f.data.Settings.Watchlist)
		},
		func() fyne.CanvasObject {
			name := widget.NewLabel("name")
			btn := widget.NewButton("删除", nil)
			return container.NewBorder(nil, nil, nil, btn, name)
		},
		func(i widget.ListItemID, o fyne.CanvasObject) {
			box, ok := o.(*fyne.Container)
			if !ok {
				return
			}
			var name *widget.Label
			var btn *widget.Button
			for _, child := range box.Objects {
				switch t := child.(type) {
				case *widget.Label:
					name = t
				case *widget.Button:
					btn = t
				}
			}
			if name == nil || btn == nil {
				return
			}
			f.mu.Lock()
			if i < 0 || i >= len(f.data.Settings.Watchlist) {
				f.mu.Unlock()
				return
			}
			s := f.data.Settings.Watchlist[i]
			f.mu.Unlock()
			name.SetText(fmt.Sprintf("%s  %s", s.Name, s.Symbol))
			idx := i
			btn.OnTapped = func() {
				f.mu.Lock()
				if idx >= 0 && idx < len(f.data.Settings.Watchlist) {
					f.data.Settings.Watchlist = append(f.data.Settings.Watchlist[:idx], f.data.Settings.Watchlist[idx+1:]...)
					_ = saveData(f.data)
				}
				f.mu.Unlock()
				watchList.Refresh()
				f.requestUI()
				go f.refreshQuotes(false)
			}
		},
	)

	f.mu.Lock()
	curInterval := f.data.Settings.RefreshInterval
	curShowSym := f.data.Settings.ShowSymbol
	curAlwaysTop := f.data.Settings.AlwaysOnTop
	curEdgeHide := f.data.Settings.EdgeAutoHide
	opVal := float64(f.data.Settings.Opacity)
	f.mu.Unlock()

	interval := widget.NewSelect([]string{"2", "5", "10", "30"}, nil)
	showSym := widget.NewCheck("显示股票代码", nil)
	alwaysTop := widget.NewCheck("窗口始终置顶（可盖住其他程序）", nil)
	edgeHide := widget.NewCheck("贴近屏幕边缘自动隐藏（留出细条，鼠标移入展开）", nil)

	interval.SetSelected(strconv.Itoa(curInterval))
	showSym.SetChecked(curShowSym)
	alwaysTop.SetChecked(curAlwaysTop)
	edgeHide.SetChecked(curEdgeHide)

	interval.OnChanged = func(v string) {
		n, _ := strconv.Atoi(v)
		f.mu.Lock()
		f.data.Settings.RefreshInterval = n
		_ = saveData(f.data)
		f.mu.Unlock()
	}
	showSym.OnChanged = func(v bool) {
		f.mu.Lock()
		f.data.Settings.ShowSymbol = v
		_ = saveData(f.data)
		f.mu.Unlock()
		f.requestUI()
	}
	alwaysTop.OnChanged = func(v bool) {
		f.mu.Lock()
		f.data.Settings.AlwaysOnTop = v
		_ = saveData(f.data)
		f.mu.Unlock()
		setAlwaysOnTop(f.win, v)
		if f.topBtn != nil {
			if v {
				f.topBtn.SetText("置顶✓")
			} else {
				f.topBtn.SetText("置顶")
			}
		}
	}
	edgeHide.OnChanged = func(v bool) {
		f.mu.Lock()
		f.data.Settings.EdgeAutoHide = v
		_ = saveData(f.data)
		if !v && f.dock.hidden {
			f.restoreFromEdge()
		}
		f.mu.Unlock()
	}

	opSlider := widget.NewSlider(1, 100)
	opSlider.Step = 1
	opSlider.SetValue(opVal)
	opLbl := widget.NewLabel(fmt.Sprintf("%d%%", int(opVal)))
	opSlider.OnChanged = func(v float64) {
		pct := int(v)
		if pct < 1 {
			pct = 1
		}
		opLbl.SetText(fmt.Sprintf("%d%%", pct))
		f.mu.Lock()
		f.data.Settings.Opacity = pct
		_ = saveData(f.data)
		f.mu.Unlock()
		setWindowOpacity(f.win, pct)
		if f.opacitySlide != nil {
			f.opacitySlide.SetValue(float64(pct))
		}
	}

	addBtn := widget.NewButton("添加", func() {
		sym := strings.TrimSpace(symbolEntry.Text)
		if sym == "" {
			errLbl.SetText("请先输入 6 位股票代码")
			errLbl.Show()
			return
		}
		msg := f.addSymbol(sym)
		if msg != "" {
			errLbl.SetText(msg)
			errLbl.Show()
			return
		}
		errLbl.SetText("已添加 " + sym)
		errLbl.Show()
		symbolEntry.SetText("")
		watchList.Refresh()
		f.requestUI()
		go f.refreshQuotes(true)
	})
	symbolEntry.OnSubmitted = func(string) { addBtn.OnTapped() }
	addBtn.Importance = widget.HighImportance

	showBtn := widget.NewButton("显示悬浮窗", func() {
		f.mu.Lock()
		f.data.Settings.Enabled = true
		_ = saveData(f.data)
		f.mu.Unlock()
		f.win.Show()
		f.setMinimized(false)
		f.applyWindowChrome()
	})
	hideBtn := widget.NewButton("隐藏到托盘", func() {
		f.win.Hide()
		f.mu.Lock()
		f.data.Settings.Enabled = false
		_ = saveData(f.data)
		f.mu.Unlock()
	})

	form := container.NewVBox(
		widget.NewLabelWithStyle("自选股票", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		container.NewBorder(nil, nil, nil, addBtn, symbolEntry),
		errLbl,
		container.NewGridWrap(fyne.NewSize(380, 200), watchList),
		widget.NewSeparator(),
		widget.NewLabelWithStyle("显示与行为", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		container.NewBorder(nil, nil, widget.NewLabel("刷新间隔(秒)"), interval),
		showSym,
		alwaysTop,
		edgeHide,
		container.NewBorder(nil, nil, widget.NewLabel("透明度(1%-100%)"), opLbl, opSlider),
		container.NewGridWithColumns(2, showBtn, hideBtn),
		widget.NewLabel("提示：无标题栏，顶部「⋮⋮ 拖动」可移动窗口；股票行可拖拽排序；「精简」隐藏上方功能。"),
	)
	w.SetContent(container.NewPadded(form))
	w.SetOnClosed(func() { f.settingsWin = nil })
	w.Show()
	w.RequestFocus()
	fyne.Do(func() { setAlwaysOnTop(w, true) })
}

func (f *floatUI) restoreFromEdge() {
	if !f.dock.hidden {
		return
	}
	moveWindow(f.win, f.dock.fullX, f.dock.fullY, f.dock.fullW, f.dock.fullH)
	f.dock.hidden = false
	f.dock.edge = ""
}

func (f *floatUI) hideToEdge(edge string, x, y, w, h int) {
	f.dock.fullX, f.dock.fullY, f.dock.fullW, f.dock.fullH = x, y, w, h
	f.dock.edge = edge
	f.dock.hidden = true
	switch edge {
	case "left":
		moveWindow(f.win, -w+peekPx, y, w, h)
	case "right":
		sw, _ := screenSize()
		moveWindow(f.win, sw-peekPx, y, w, h)
	case "top":
		moveWindow(f.win, x, -h+peekPx, w, h)
	case "bottom":
		_, sh := screenSize()
		moveWindow(f.win, x, sh-peekPx, w, h)
	}
}

func pointInRect(px, py, x, y, w, h int) bool {
	return px >= x && px <= x+w && py >= y && py <= y+h
}

func (f *floatUI) tickEdgeAutoHide() {
	f.mu.Lock()
	enabled := f.data.Settings.EdgeAutoHide && !f.minimized
	hidden := f.dock.hidden
	f.mu.Unlock()
	if !enabled || !windowVisible(f.win) {
		return
	}

	cx, cy, cok := cursorPos()
	x, y, w, h, rok := getWindowRect(f.win)
	if !cok || !rok {
		return
	}

	if hidden {
		// Expand hit area around peek strip
		hitX, hitY, hitW, hitH := x, y, w, h
		switch f.dock.edge {
		case "left":
			hitX, hitW = 0, peekPx+24
		case "right":
			sw, _ := screenSize()
			hitX, hitW = sw-peekPx-24, peekPx+24
		case "top":
			hitY, hitH = 0, peekPx+24
		case "bottom":
			_, sh := screenSize()
			hitY, hitH = sh-peekPx-24, peekPx+24
		}
		if pointInRect(cx, cy, hitX, hitY, hitW, hitH) {
			f.mu.Lock()
			f.restoreFromEdge()
			f.mu.Unlock()
		}
		return
	}

	if pointInRect(cx, cy, x, y, w, h) {
		f.dock.nearAt = time.Time{}
		return
	}

	sw, sh := screenSize()
	edge := ""
	if x <= edgePx {
		edge = "left"
	} else if x+w >= sw-edgePx {
		edge = "right"
	} else if y <= edgePx {
		edge = "top"
	} else if y+h >= sh-edgePx {
		edge = "bottom"
	}
	if edge == "" {
		f.dock.nearAt = time.Time{}
		return
	}
	if f.dock.nearAt.IsZero() {
		f.dock.nearAt = time.Now()
		return
	}
	if time.Since(f.dock.nearAt) < 700*time.Millisecond {
		return
	}
	f.mu.Lock()
	f.hideToEdge(edge, x, y, w, h)
	f.dock.nearAt = time.Time{}
	f.mu.Unlock()
}

func openDataDir() {
	dir := filepath.Dir(dataPath())
	switch runtime.GOOS {
	case "windows":
		_ = exec.Command("explorer", dir).Start()
	case "darwin":
		_ = exec.Command("open", dir).Start()
	default:
		_ = exec.Command("xdg-open", dir).Start()
	}
}

func main() {
	a := app.NewWithID(appID)
	a.Settings().SetTheme(&lightTheme{})
	data := loadData()

	ui := &floatUI{
		app:  a,
		data: data,
	}
	w := a.NewWindow(appTitle)
	ui.win = w
	w.SetMaster()
	w.Resize(fyne.NewSize(300, 420))
	w.SetCloseIntercept(func() {
		w.Hide()
		ui.mu.Lock()
		ui.data.Settings.Enabled = false
		_ = saveData(ui.data)
		ui.mu.Unlock()
	})
	ui.applyModeContent()

	go func() {
		t := time.NewTicker(1 * time.Second)
		defer t.Stop()
		for range t.C {
			fyne.Do(func() {
				if ui.clockLbl != nil && !ui.minimized {
					ui.clockLbl.SetText(cstNow().Format("15:04:05"))
				}
			})
			ui.tickEdgeAutoHide()
		}
	}()

	if desk, ok := a.(desktop.App); ok {
		menu := fyne.NewMenu(appTitle,
			fyne.NewMenuItem("显示悬浮窗", func() {
				ui.mu.Lock()
				ui.data.Settings.Enabled = true
				_ = saveData(ui.data)
				ui.mu.Unlock()
				w.Show()
				ui.setMinimized(false)
				ui.applyWindowChrome()
			}),
			fyne.NewMenuItem("设置", ui.openSettings),
			fyne.NewMenuItem("打开数据目录", openDataDir),
			fyne.NewMenuItemSeparator(),
			fyne.NewMenuItem("退出", func() { a.Quit() }),
		)
		desk.SetSystemTrayMenu(menu)
		desk.SetSystemTrayIcon(theme.ComputerIcon())
	}

	go func() {
		ui.refreshQuotes(false)
		for {
			ui.mu.Lock()
			sec := ui.data.Settings.RefreshInterval
			ui.mu.Unlock()
			if sec <= 0 {
				sec = 2
			}
			time.Sleep(time.Duration(sec) * time.Second)
			ui.refreshQuotes(false)
		}
	}()

	if data.Settings.Enabled {
		w.Show()
	}
	// Apply native chrome after first paint
	go func() {
		time.Sleep(300 * time.Millisecond)
		ui.applyWindowChrome()
	}()
	a.Run()
}
