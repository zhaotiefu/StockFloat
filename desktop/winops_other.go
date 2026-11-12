//go:build !windows

package main

import (
	"fyne.io/fyne/v2"
)

// Non-Windows stubs: always-on-top / opacity / edge geometry are Windows-native.
// UI controls still work so settings and behaviour can be verified on Linux.

func setAlwaysOnTop(w fyne.Window, on bool) {}

func setWindowOpacity(w fyne.Window, percent int) {}

func getWindowRect(w fyne.Window) (x, y, width, height int, ok bool) {
	return 0, 0, 0, 0, false
}

func moveWindow(w fyne.Window, x, y, width, height int) {}

func cursorPos() (x, y int, ok bool) {
	return 0, 0, false
}

func screenSize() (w, h int) {
	return 1920, 1080
}

func windowVisible(w fyne.Window) bool {
	return true
}
