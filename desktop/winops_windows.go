//go:build windows

package main

import (
	"syscall"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver"
)

var (
	user32                         = syscall.NewLazyDLL("user32.dll")
	procSetWindowLongW             = user32.NewProc("SetWindowLongW")
	procGetWindowLongW             = user32.NewProc("GetWindowLongW")
	procSetLayeredWindowAttributes = user32.NewProc("SetLayeredWindowAttributes")
)

const (
	gwlExStyle  = uintptr(0xFFFFFFEC) // -20
	wsExLayered = 0x00080000
	lwaAlpha    = 0x00000002
)

func setWindowOpacity(w fyne.Window, percent int) {
	percent = clampOpacity(percent)
	alpha := byte(percent * 255 / 100)
	nw, ok := w.(driver.NativeWindow)
	if !ok {
		return
	}
	nw.RunNative(func(ctx any) {
		wc, ok := ctx.(driver.WindowsWindowContext)
		if !ok || wc.HWND == 0 {
			return
		}
		hwnd := wc.HWND
		style, _, _ := procGetWindowLongW.Call(hwnd, gwlExStyle)
		_, _, _ = procSetWindowLongW.Call(hwnd, gwlExStyle, style|wsExLayered)
		_, _, _ = procSetLayeredWindowAttributes.Call(hwnd, 0, uintptr(alpha), uintptr(lwaAlpha))
	})
}
