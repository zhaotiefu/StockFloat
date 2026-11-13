package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image/color"
	"io"
	"net"
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
	"fyne.io/fyne/v2/layout"
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
	Opacity         int          `json:"opacity"` // 1-100, step 1%
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

func clampOpacity(v int) int {
	if v < 1 {
		return 1
	}
	if v > 100 {
		return 100
	}
	return v
}

func defaultData() AppData {
	return AppData{
		Settings: Settings{
			Enabled:         true,
			RefreshInterval: 2,
			ShowSymbol:      false,
			Opacity:         100,
			Watchlist: []WatchStock{
				{Symbol: "601318", Name: "中国平安", Board: "SH"},
				{Symbol: "600519", Name: "贵州茅台", Board: "SH"},
				{Symbol: "600036", Name: "招商银行", Board: "SH"},
				{Symbol: "300750", Name: "宁德时代", Board: "SZ"},
			},
		},
	}
}

var dataPath = func() string {
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
	if d.Settings.RefreshInterval <= 0 {
		d.Settings.RefreshInterval = 2
	}
	if d.Settings.Opacity == 0 {
		d.Settings.Opacity = 100
	}
	d.Settings.Opacity = clampOpacity(d.Settings.Opacity)
	if len(d.Settings.Watchlist) == 0 {
		d.Settings.Watchlist = defaultData().Settings.Watchlist
	}
	return d
}

func saveData(d AppData) error {
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

func removeSymbol(list []WatchStock, symbol string) []WatchStock {
	next := make([]WatchStock, 0, len(list))
	for _, item := range list {
		if item.Symbol != symbol {
			next = append(next, item)
		}
	}
	return next
}

func decodeGBK(b []byte) string {
	out, err := io.ReadAll(transform.NewReader(bytes.NewReader(b), simplifiedchinese.GBK.NewDecoder()))
	if err != nil || len(out) == 0 {
		if utf8.Valid(b) {
			return string(b)
		}
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
		return color.NRGBA{R: 255, G: 255, B: 255, A: 245}
	case theme.ColorNameButton:
		return color.NRGBA{R: 15, G: 118, B: 110, A: 255}
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
func (lightTheme) Font(s fyne.TextStyle) fyne.Resource      { return theme.DefaultTheme().Font(s) }
func (lightTheme) Icon(n fyne.ThemeIconName) fyne.Resource  { return theme.DefaultTheme().Icon(n) }
func (lightTheme) Size(n fyne.ThemeSizeName) float32        { return theme.DefaultTheme().Size(n) }

type floatUI struct {
	mu          sync.Mutex
	data        AppData
	quotes      []Quote
	lastErr     string
	updatedAt   time.Time
	app         fyne.App
	win         fyne.Window
	listBox     *fyne.Container
	statusLbl   *widget.Label
	timeLbl     *dblTapLabel
	minimized   bool
	compact     bool
	settingsWin fyne.Window
	uiPulse     chan struct{}
}

func (f *floatUI) requestUI() {
	select {
	case f.uiPulse <- struct{}{}:
	default:
	}
}

func (f *floatUI) runOnUI(fn func()) {
	if fyne.CurrentApp() == nil {
		fn()
		return
	}
	fyne.Do(fn)
}

func (f *floatUI) rebuildList() {
	f.mu.Lock()
	quotes := append([]Quote{}, f.quotes...)
	watch := append([]WatchStock{}, f.data.Settings.Watchlist...)
	showSym := f.data.Settings.ShowSymbol
	lastErr := f.lastErr
	updatedAt := f.updatedAt
	listBox := f.listBox
	statusLbl := f.statusLbl
	timeLbl := f.timeLbl
	f.mu.Unlock()
	if listBox == nil || statusLbl == nil || timeLbl == nil {
		return
	}

	items := []fyne.CanvasObject{}
	qmap := map[string]Quote{}
	for _, q := range quotes {
		qmap[q.Symbol] = q
	}
	if len(watch) == 0 {
		items = append(items, widget.NewLabel("尚未添加自选股票"))
	}
	for _, s := range watch {
		q := qmap[s.Symbol]
		name := s.Name
		if q.Name != "" {
			name = q.Name
		}
		leftText := name
		if showSym {
			leftText = fmt.Sprintf("%s\n%s", name, s.Symbol)
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
		nameLbl := widget.NewLabel(leftText)
		priceLbl := canvas.NewText(price, color.NRGBA{R: 51, G: 65, B: 85, A: 255})
		priceLbl.TextSize = 13
		priceLbl.Alignment = fyne.TextAlignTrailing
		chgLbl := canvas.NewText(chg, chgColor)
		chgLbl.TextSize = 13
		chgLbl.TextStyle = fyne.TextStyle{Bold: true}
		chgLbl.Alignment = fyne.TextAlignTrailing
		row := container.NewBorder(nil, nil, nameLbl, container.NewHBox(layout.NewSpacer(), priceLbl, widget.NewLabel("  "), chgLbl))
		items = append(items, newStockDragRow(f, len(items), container.NewPadded(row)))
	}
	listBox.Objects = items
	listBox.Refresh()

	if lastErr != "" {
		statusLbl.SetText("更新异常")
		timeLbl.SetText(lastErr)
	} else {
		statusLbl.SetText("自动刷新中")
		if updatedAt.IsZero() {
			timeLbl.SetText("--:--:--")
		} else {
			timeLbl.SetText(updatedAt.In(time.FixedZone("CST", 8*3600)).Format("15:04:05"))
		}
	}
}

func (f *floatUI) moveStock(from, to int) bool {
	f.mu.Lock()
	n := len(f.data.Settings.Watchlist)
	if from < 0 || to < 0 || from >= n || to >= n || from == to {
		f.mu.Unlock()
		return false
	}
	f.data.Settings.Watchlist[from], f.data.Settings.Watchlist[to] = f.data.Settings.Watchlist[to], f.data.Settings.Watchlist[from]
	_ = saveData(f.data)
	listBox := f.listBox
	f.mu.Unlock()
	if listBox != nil && from < len(listBox.Objects) && to < len(listBox.Objects) {
		listBox.Objects[from], listBox.Objects[to] = listBox.Objects[to], listBox.Objects[from]
		if a, ok := listBox.Objects[from].(*stockDragRow); ok {
			a.index = from
		}
		if b, ok := listBox.Objects[to].(*stockDragRow); ok {
			b.index = to
		}
		listBox.Refresh()
	}
	return true
}

func (f *floatUI) refreshQuotes() {
	f.mu.Lock()
	watch := append([]WatchStock{}, f.data.Settings.Watchlist...)
	f.mu.Unlock()
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
	f.mu.Unlock()
	f.requestUI()
}

func (f *floatUI) applyOpacity() {
	f.mu.Lock()
	op := f.data.Settings.Opacity
	f.mu.Unlock()
	setWindowOpacity(f.win, op)
}

func (f *floatUI) setMinimized(v bool) {
	f.minimized = v
	if v {
		f.win.Resize(fyne.NewSize(180, 48))
		f.win.SetContent(container.NewPadded(widget.NewButton("STOCK  点击恢复", func() {
			f.setMinimized(false)
		})))
	} else {
		f.win.Resize(fyne.NewSize(360, 360))
		f.win.SetContent(f.fullContent())
		f.rebuildList()
	}
	f.applyOpacity()
}

func (f *floatUI) setCompact(v bool) {
	f.compact = v
	if v {
		f.win.SetTitle(appTitle + " · 精简")
	} else {
		f.win.SetTitle(appTitle)
	}
	if f.minimized {
		f.setMinimized(false)
		return
	}
	f.win.SetContent(f.fullContent())
	f.rebuildList()
	f.applyOpacity()
}

func (f *floatUI) fullContent() fyne.CanvasObject {
	title := widget.NewLabelWithStyle("STOCK FLOAT", fyne.TextAlignLeading, fyne.TextStyle{Bold: true})
	btnSettings := widget.NewButton("设置", f.openSettings)
	btnMin := widget.NewButton("缩小", func() { f.setMinimized(true) })
	btnHide := widget.NewButton("隐藏", func() {
		f.win.Hide()
		f.mu.Lock()
		f.data.Settings.Enabled = false
		_ = saveData(f.data)
		f.mu.Unlock()
	})
	btnCompact := widget.NewButton("精简", func() { f.setCompact(true) })
	btnRefresh := widget.NewButton("刷新", func() { go f.refreshQuotes() })
	header := container.NewBorder(nil, nil, title, container.NewHBox(btnSettings, btnMin, btnHide, btnCompact))
	f.listBox = container.NewVBox()
	scroll := container.NewVScroll(f.listBox)
	timeLbl := newDblTapLabel("--:--:--", func() {
		if f.compact {
			f.setCompact(false)
		}
	})
	f.timeLbl = timeLbl
	f.statusLbl = widget.NewLabel("自动刷新中")
	footer := container.NewBorder(nil, nil, timeLbl, container.NewHBox(f.statusLbl, btnRefresh))
	if f.compact {
		// Hide everything above the stock list; double-click time to restore.
		return container.NewBorder(nil, container.NewPadded(footer), nil, nil, scroll)
	}
	topPad := canvas.NewRectangle(color.NRGBA{R: 255, G: 255, B: 255, A: 0})
	topPad.SetMinSize(fyne.NewSize(1, 8))
	return container.NewBorder(
		container.NewVBox(topPad, container.NewPadded(header)),
		container.NewPadded(footer),
		nil, nil, scroll,
	)
}

func (f *floatUI) openSettings() {
	if f.settingsWin != nil {
		f.win.Hide()
		f.settingsWin.Show()
		f.settingsWin.RequestFocus()
		return
	}
	// Hide float while editing so it does not cover settings controls.
	f.win.Hide()
	w := f.app.NewWindow("Stock Float 设置")
	f.settingsWin = w
	w.Resize(fyne.NewSize(400, 640))
	w.CenterOnScreen()

	symbolEntry := widget.NewEntry()
	symbolEntry.SetPlaceHolder("输入 6 位代码，如 601318")
	errLbl := widget.NewLabel("")
	errLbl.Hide()

	watchBox := container.NewVBox()
	var refreshWatch func()
	refreshWatch = func() {
		f.mu.Lock()
		watch := append([]WatchStock{}, f.data.Settings.Watchlist...)
		f.mu.Unlock()
		rows := make([]fyne.CanvasObject, 0, len(watch))
		for _, s := range watch {
			sym := s.Symbol
			btn := widget.NewButton("删除", func() {
				f.mu.Lock()
				f.data.Settings.Watchlist = removeSymbol(f.data.Settings.Watchlist, sym)
				_ = saveData(f.data)
				f.mu.Unlock()
				errLbl.Hide()
				refreshWatch()
				f.requestUI()
				go f.refreshQuotes()
			})
			rows = append(rows, container.NewBorder(nil, nil,
				widget.NewLabel(fmt.Sprintf("%s  %s", s.Name, s.Symbol)), btn))
		}
		if len(rows) == 0 {
			rows = append(rows, widget.NewLabel("尚未添加自选股票"))
		}
		watchBox.Objects = rows
		watchBox.Refresh()
	}
	refreshWatch()

	f.mu.Lock()
	curInterval := strconv.Itoa(f.data.Settings.RefreshInterval)
	curShowSym := f.data.Settings.ShowSymbol
	curOpacity := float64(clampOpacity(f.data.Settings.Opacity))
	f.mu.Unlock()

	interval := widget.NewRadioGroup([]string{"2", "5", "10", "30"}, func(v string) {
		if v == "" {
			return
		}
		n, _ := strconv.Atoi(v)
		f.mu.Lock()
		f.data.Settings.RefreshInterval = n
		_ = saveData(f.data)
		f.mu.Unlock()
	})
	interval.Horizontal = true
	interval.SetSelected(curInterval)
	showSym := widget.NewCheck("显示股票代码", func(v bool) {
		f.mu.Lock()
		f.data.Settings.ShowSymbol = v
		_ = saveData(f.data)
		f.mu.Unlock()
		f.requestUI()
	})
	showSym.SetChecked(curShowSym)

	opacityLbl := widget.NewLabel(fmt.Sprintf("透明度 %d%%（步进 1%%）", int(curOpacity)))
	opacity := widget.NewSlider(1, 100)
	opacity.Step = 1
	opacity.SetValue(curOpacity)
	opacity.OnChanged = func(v float64) {
		n := clampOpacity(int(v + 0.5))
		opacityLbl.SetText(fmt.Sprintf("透明度 %d%%", n))
		f.mu.Lock()
		f.data.Settings.Opacity = n
		_ = saveData(f.data)
		f.mu.Unlock()
		f.applyOpacity()
	}

	doAdd := func() {
		sym := strings.TrimSpace(symbolEntry.Text)
		board, ok := inferBoard(sym)
		if !ok {
			errLbl.SetText("请输入合法 6 位 A 股代码")
			errLbl.Show()
			return
		}
		f.mu.Lock()
		for _, s := range f.data.Settings.Watchlist {
			if s.Symbol == sym {
				f.mu.Unlock()
				errLbl.SetText("该股票已在自选列表中")
				errLbl.Show()
				return
			}
		}
		if len(f.data.Settings.Watchlist) >= maxWatch {
			f.mu.Unlock()
			errLbl.SetText(fmt.Sprintf("自选最多 %d 只", maxWatch))
			errLbl.Show()
			return
		}
		f.data.Settings.Watchlist = append(f.data.Settings.Watchlist, WatchStock{Symbol: sym, Name: sym, Board: board})
		_ = saveData(f.data)
		f.mu.Unlock()
		errLbl.Hide()
		symbolEntry.SetText("")
		refreshWatch()
		f.requestUI()
		go f.refreshQuotes()
	}
	addBtn := widget.NewButton("添加", doAdd)
	symbolEntry.OnSubmitted = func(string) { doAdd() }

	showBtn := widget.NewButton("显示悬浮窗", func() {
		f.mu.Lock()
		f.data.Settings.Enabled = true
		_ = saveData(f.data)
		f.mu.Unlock()
		f.win.Show()
		f.setMinimized(false)
		f.applyOpacity()
		f.win.RequestFocus()
	})

	watchScroll := container.NewVScroll(watchBox)
	watchScroll.SetMinSize(fyne.NewSize(360, 180))
	form := container.NewVBox(
		widget.NewLabelWithStyle("自选股票", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		symbolEntry,
		addBtn,
		errLbl,
		watchScroll,
		widget.NewSeparator(),
		widget.NewLabelWithStyle("设置", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		widget.NewLabel("刷新间隔(秒)"),
		interval,
		showSym,
		opacityLbl,
		opacity,
		showBtn,
		widget.NewLabel("托盘菜单可重新显示悬浮窗；配置在程序同目录 stockfloat-data.json"),
	)
	w.SetContent(container.NewPadded(form))
	w.SetOnClosed(func() {
		f.settingsWin = nil
		f.mu.Lock()
		enabled := f.data.Settings.Enabled
		f.mu.Unlock()
		if enabled {
			f.win.Show()
			f.setMinimized(false)
		}
	})
	w.Show()
	w.RequestFocus()
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

func acquireSingleton() (net.Listener, error) {
	// Local port lock keeps a single portable instance without platform-specific flock.
	return net.Listen("tcp", "127.0.0.1:45917")
}

func main() {
	lock, err := acquireSingleton()
	if err != nil {
		fmt.Fprintln(os.Stderr, "Stock Float 已在运行")
		os.Exit(0)
	}
	defer lock.Close()

	a := app.NewWithID(appID)
	a.Settings().SetTheme(&lightTheme{})
	data := loadData()

	ui := &floatUI{app: a, data: data, uiPulse: make(chan struct{}, 1)}
	w := a.NewWindow(appTitle)
	ui.win = w
	w.Resize(fyne.NewSize(360, 360))
	w.SetCloseIntercept(func() {
		w.Hide()
		ui.mu.Lock()
		ui.data.Settings.Enabled = false
		_ = saveData(ui.data)
		ui.mu.Unlock()
	})
	w.SetContent(ui.fullContent())

	go func() {
		for range ui.uiPulse {
			ui.runOnUI(ui.rebuildList)
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
		ui.refreshQuotes()
		for {
			ui.mu.Lock()
			sec := ui.data.Settings.RefreshInterval
			ui.mu.Unlock()
			if sec <= 0 {
				sec = 2
			}
			time.Sleep(time.Duration(sec) * time.Second)
			ui.refreshQuotes()
		}
	}()

	if data.Settings.Enabled {
		w.Show()
	}
	go func() {
		time.Sleep(300 * time.Millisecond)
		ui.runOnUI(ui.applyOpacity)
	}()
	a.Run()
}
