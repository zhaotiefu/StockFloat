//go:build windows

package main

import (
	"syscall"
	"unsafe"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver"
)

var (
	user32                         = syscall.NewLazyDLL("user32.dll")
	procSetWindowPos               = user32.NewProc("SetWindowPos")
	procSetWindowLongW             = user32.NewProc("SetWindowLongW")
	procGetWindowLongW             = user32.NewProc("GetWindowLongW")
	procSetLayeredWindowAttributes = user32.NewProc("SetLayeredWindowAttributes")
	procFindWindowW                = user32.NewProc("FindWindowW")
	procShowWindow                 = user32.NewProc("ShowWindow")
	procSetWindowTextW             = user32.NewProc("SetWindowTextW")
)

const (
	hwndTopMost    = ^uintptr(0) // -1
	hwndNoTopMost  = ^uintptr(1) // -2
	swpNoMove      = 0x0002
	swpNoSize      = 0x0001
	swpNoActivate  = 0x0010
	swpShowWindow  = 0x0040
	swpHideWindow  = 0x0080
	gwlExStyle     = uintptr(0xFFFFFFEC) // -20
	wsExLayered    = 0x00080000
	wsExToolWindow = 0x00000080
	wsExAppWindow  = 0x00040000
	wsExNoActivate = 0x08000000
	lwaAlpha       = 0x00000002
	swHide         = 0
)

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

func setWindowOpacity(w fyne.Window, percent int) {
	percent = clampOpacity(percent)
	alpha := byte(percent * 255 / 100)
	withHWND(w, func(hwnd uintptr) {
		style, _, _ := procGetWindowLongW.Call(hwnd, gwlExStyle)
		_, _, _ = procSetWindowLongW.Call(hwnd, gwlExStyle, style|wsExLayered)
		_, _, _ = procSetLayeredWindowAttributes.Call(hwnd, 0, uintptr(alpha), uintptr(lwaAlpha))
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

func setSkipTaskbar(w fyne.Window, skip bool) {
	withHWND(w, func(hwnd uintptr) {
		style, _, _ := procGetWindowLongW.Call(hwnd, gwlExStyle)
		if skip {
			style = (style | wsExToolWindow) &^ wsExAppWindow
		} else {
			style = (style | wsExAppWindow) &^ wsExToolWindow
		}
		_, _, _ = procSetWindowLongW.Call(hwnd, gwlExStyle, style)
		_, _, _ = procSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0, uintptr(swpNoMove|swpNoSize|swpNoActivate|swpShowWindow))
	})
}

func hideAuxiliaryTaskbarWindows() {
	// Fyne creates an internal "SystrayMonitor" window for tray lifecycle.
	// Hide it completely so it never appears as a visible/extra window.
	name, err := syscall.UTF16PtrFromString("SystrayMonitor")
	if err != nil {
		return
	}
	hwnd, _, _ := procFindWindowW.Call(0, uintptr(unsafe.Pointer(name)))
	if hwnd == 0 {
		return
	}
	style, _, _ := procGetWindowLongW.Call(hwnd, gwlExStyle)
	style = (style | wsExToolWindow | wsExNoActivate) &^ wsExAppWindow
	_, _, _ = procSetWindowLongW.Call(hwnd, gwlExStyle, style)
	empty, _ := syscall.UTF16PtrFromString("")
	_, _, _ = procSetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(empty)))
	_, _, _ = procShowWindow.Call(hwnd, uintptr(swHide))
	_, _, _ = procSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0, uintptr(swpNoMove|swpNoSize|swpNoActivate|swpHideWindow))
}
