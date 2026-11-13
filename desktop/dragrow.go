package main

import (
	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/widget"
)

// stockDragRow supports vertical drag-to-reorder of watchlist rows.
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
	if r.inner != nil {
		return r.inner.MinSize()
	}
	return fyne.NewSize(100, 24)
}

func (r *stockDragRow) Resize(s fyne.Size) {
	r.BaseWidget.Resize(s)
	if r.inner != nil {
		r.inner.Resize(s)
	}
}

func (r *stockDragRow) Dragged(e *fyne.DragEvent) {
	r.accum += e.Dragged.DY
	const threshold float32 = 18
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

func (r *stockDragRow) DragEnd() { r.accum = 0 }

var _ fyne.Draggable = (*stockDragRow)(nil)

// dblTapLabel shows text and handles double-click (restore compact chrome).
type dblTapLabel struct {
	widget.BaseWidget
	label    *widget.Label
	onDouble func()
}

func newDblTapLabel(text string, onDouble func()) *dblTapLabel {
	l := &dblTapLabel{label: widget.NewLabel(text), onDouble: onDouble}
	l.ExtendBaseWidget(l)
	return l
}

func (l *dblTapLabel) CreateRenderer() fyne.WidgetRenderer {
	return widget.NewSimpleRenderer(l.label)
}

func (l *dblTapLabel) SetText(text string) {
	if l.label != nil {
		l.label.SetText(text)
	}
}

func (l *dblTapLabel) MinSize() fyne.Size {
	if l.label != nil {
		return l.label.MinSize()
	}
	return fyne.NewSize(40, 20)
}

func (l *dblTapLabel) Resize(s fyne.Size) {
	l.BaseWidget.Resize(s)
	if l.label != nil {
		l.label.Resize(s)
	}
}

func (l *dblTapLabel) DoubleTapped(_ *fyne.PointEvent) {
	if l.onDouble != nil {
		l.onDouble()
	}
}

var _ fyne.DoubleTappable = (*dblTapLabel)(nil)
