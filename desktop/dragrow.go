package main

import (
	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/widget"
)

// tightList lays out children with only 1px vertical gaps.
type tightList struct{}

func (t tightList) Layout(objects []fyne.CanvasObject, size fyne.Size) {
	y := float32(0)
	for _, o := range objects {
		if o == nil || !o.Visible() {
			continue
		}
		h := o.MinSize().Height
		o.Move(fyne.NewPos(0, y))
		o.Resize(fyne.NewSize(size.Width, h))
		y += h + 1
	}
}

func (t tightList) MinSize(objects []fyne.CanvasObject) fyne.Size {
	w, h := float32(0), float32(0)
	n := 0
	for _, o := range objects {
		if o == nil || !o.Visible() {
			continue
		}
		s := o.MinSize()
		if s.Width > w {
			w = s.Width
		}
		h += s.Height
		n++
	}
	if n > 1 {
		h += float32(n - 1) // 1px gaps
	}
	return fyne.NewSize(w, h)
}

// stockDragRow is a tight list row that supports vertical drag-to-reorder.
type stockDragRow struct {
	widget.BaseWidget
	ui    *floatUI
	index int
	inner fyne.CanvasObject
	accum float32
}

func newStockDragRow(ui *floatUI, index int, inner fyne.CanvasObject) *stockDragRow {
	r := &stockDragRow{ui: ui, index: index, inner: inner}
	r.ExtendBaseWidget(r)
	return r
}

func (r *stockDragRow) CreateRenderer() fyne.WidgetRenderer {
	return widget.NewSimpleRenderer(r.inner)
}

func (r *stockDragRow) MinSize() fyne.Size {
	w := float32(100)
	if r.inner != nil {
		w = r.inner.MinSize().Width
	}
	// Force a short row so the list stays visually tight.
	return fyne.NewSize(w, 18)
}

func (r *stockDragRow) Resize(s fyne.Size) {
	r.BaseWidget.Resize(s)
	if r.inner != nil {
		r.inner.Resize(s)
	}
}

func (r *stockDragRow) Dragged(e *fyne.DragEvent) {
	r.accum += e.Dragged.DY
	const threshold float32 = 16
	for r.accum >= threshold {
		if !r.ui.moveStock(r.index, r.index+1) {
			r.accum = 0
			return
		}
		r.index++
		r.accum -= threshold
	}
	for r.accum <= -threshold {
		if !r.ui.moveStock(r.index, r.index-1) {
			r.accum = 0
			return
		}
		r.index--
		r.accum += threshold
	}
}

func (r *stockDragRow) DragEnd() {
	r.accum = 0
}

// Ensure interface compliance.
var _ fyne.Draggable = (*stockDragRow)(nil)

// dragHandle lets the user move a frameless window by dragging the header strip.
type dragHandle struct {
	widget.BaseWidget
	win     fyne.Window
	content fyne.CanvasObject
}

func newDragHandle(win fyne.Window, content fyne.CanvasObject) *dragHandle {
	d := &dragHandle{win: win, content: content}
	d.ExtendBaseWidget(d)
	return d
}

func (d *dragHandle) CreateRenderer() fyne.WidgetRenderer {
	return widget.NewSimpleRenderer(d.content)
}

func (d *dragHandle) MinSize() fyne.Size {
	if d.content == nil {
		return fyne.NewSize(40, 28)
	}
	return d.content.MinSize()
}

func (d *dragHandle) Dragged(e *fyne.DragEvent) {
	x, y, w, h, ok := getWindowRect(d.win)
	if !ok {
		return
	}
	moveWindow(d.win, x+int(e.Dragged.DX), y+int(e.Dragged.DY), w, h)
}

func (d *dragHandle) DragEnd() {}

var _ fyne.Draggable = (*dragHandle)(nil)
