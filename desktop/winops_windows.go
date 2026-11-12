//go:build windows

package main

import (
	"syscall"
	"unsafe"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver"
)

var (
	user32                       = syscall.NewLazyDLL("user32.dll")
	procSetWindowPos              = user32.NewProc("SetWindowPos")
	procSetWindowLongW            = user32.NewProc("SetWindowLongW")
	procGetWindowLongW            = user32.NewProc("GetWindowLongW")
	procSetLayeredWindowAttributes = user32.NewProc("SetLayeredWindowAttributes")
	procGetWindowRect             = user32.NewProc("GetWindowRect")
	procGetCursorPos              = user32.NewProc("GetCursorPos")
	procGetSystemMetrics          = user32.NewProc("GetSystemMetrics")
	procMoveWindow                = user32.NewProc("MoveWindow")
	procIsWindowVisible           = user32.NewProc("IsWindowVisible")
)

const (
	hwndTopMost    = ^uintptr(0) // HWND_TOPMOST (-1)
	hwndNoTopMost  = ^uintptr(1) // HWND_NOTOPMOST (-2)
	swpNoMove      = 0x0002
	swpNoSize      = 0x0001
	swpNoActivate  = 0x0010
	swpShowWindow  = 0x0040
	gwlExStyle     = uintptr(0xFFFFFFEC) // -20
	wsExLayered    = 0x00080000
	lwaAlpha       = 0x00000002
	smCXScreen     = 0
	smCYScreen     = 1
)

type winRECT struct {
	Left, Top, Right, Bottom int32
}

type winPOINT struct {
	X, Y int32
}

func withHWND(w fyne.Window, fn func(hwnd uintptr)) {
	nw, ok := w.(driver.NativeWindow)
	if !ok {
		return
	}
	nw.RunNative(func(ctx any) {
		wc, ok := ctx.(driver.WindowsWindowContext)
		if !ok || wc.HWND == 0 {
			return
		}
		fn(wc.HWND)
	})
}

func setAlwaysOnTop(w fyne.Window, on bool) {
	withHWND(w, func(hwnd uintptr) {
		insert := hwndNoTopMost
		if on {
			insert = hwndTopMost
		}
		_, _, _ = procSetWindowPos.Call(hwnd, insert, 0, 0, 0, 0, uintptr(swpNoMove|swpNoSize|swpNoActivate|swpShowWindow))
	})
}

func setWindowOpacity(w fyne.Window, percent int) {
	if percent < 10 {
		percent = 10
	}
	if percent > 100 {
		percent = 100
	}
	alpha := byte(percent * 255 / 100)
	withHWND(w, func(hwnd uintptr) {
		style, _, _ := procGetWindowLongW.Call(hwnd, gwlExStyle)
		_, _, _ = procSetWindowLongW.Call(hwnd, gwlExStyle, style|wsExLayered)
		_, _, _ = procSetLayeredWindowAttributes.Call(hwnd, 0, uintptr(alpha), uintptr(lwaAlpha))
	})
}

func getWindowRect(w fyne.Window) (x, y, width, height int, ok bool) {
	var out winRECT
	var found bool
	withHWND(w, func(hwnd uintptr) {
		r, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&out)))
		if r != 0 {
			found = true
		}
	})
	if !found {
		return 0, 0, 0, 0, false
	}
	return int(out.Left), int(out.Top), int(out.Right - out.Left), int(out.Bottom - out.Top), true
}

func moveWindow(w fyne.Window, x, y, width, height int) {
	withHWND(w, func(hwnd uintptr) {
		_, _, _ = procMoveWindow.Call(hwnd, uintptr(x), uintptr(y), uintptr(width), uintptr(height), 1)
	})
}

func cursorPos() (x, y int, ok bool) {
	var p winPOINT
	r, _, _ := procGetCursorPos.Call(uintptr(unsafe.Pointer(&p)))
	if r == 0 {
		return 0, 0, false
	}
	return int(p.X), int(p.Y), true
}

func screenSize() (w, h int) {
	cw, _, _ := procGetSystemMetrics.Call(smCXScreen)
	ch, _, _ := procGetSystemMetrics.Call(smCYScreen)
	return int(cw), int(ch)
}

func windowVisible(w fyne.Window) bool {
	vis := false
	withHWND(w, func(hwnd uintptr) {
		r, _, _ := procIsWindowVisible.Call(hwnd)
		vis = r != 0
	})
	return vis
}
