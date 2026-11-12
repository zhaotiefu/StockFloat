//go:build !windows

package main

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"

	"fyne.io/fyne/v2"
)

func setAlwaysOnTop(w fyne.Window, on bool) {}

func setWindowOpacity(w fyne.Window, percent int) {}

func setFrameless(w fyne.Window) {
	// Best-effort: strip decorations via Motif hints for local Linux testing.
	id := x11WindowIDByTitle(appTitle)
	if id == "" {
		return
	}
	_ = exec.Command("xprop", "-id", id,
		"-f", "_MOTIF_WM_HINTS", "32c",
		"-set", "_MOTIF_WM_HINTS", "0x2, 0x0, 0x0, 0x0, 0x0").Run()
}

func getWindowRect(w fyne.Window) (x, y, width, height int, ok bool) {
	id := x11WindowIDByTitle(appTitle)
	if id == "" {
		return 0, 0, 0, 0, false
	}
	out, err := exec.Command("xdotool", "getwindowgeometry", "--shell", id).Output()
	if err != nil {
		return 0, 0, 0, 0, false
	}
	vals := map[string]int{}
	for _, line := range strings.Split(string(out), "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), "=", 2)
		if len(parts) != 2 {
			continue
		}
		n, err := strconv.Atoi(parts[1])
		if err == nil {
			vals[parts[0]] = n
		}
	}
	x, y = vals["X"], vals["Y"]
	width, height = vals["WIDTH"], vals["HEIGHT"]
	if width <= 0 || height <= 0 {
		return 0, 0, 0, 0, false
	}
	return x, y, width, height, true
}

func moveWindow(w fyne.Window, x, y, width, height int) {
	id := x11WindowIDByTitle(appTitle)
	if id == "" {
		return
	}
	_ = exec.Command("xdotool", "windowmove", id, fmt.Sprintf("%d", x), fmt.Sprintf("%d", y)).Run()
	if width > 0 && height > 0 {
		_ = exec.Command("xdotool", "windowsize", id, fmt.Sprintf("%d", width), fmt.Sprintf("%d", height)).Run()
	}
}

func cursorPos() (x, y int, ok bool) {
	out, err := exec.Command("xdotool", "getmouselocation", "--shell").Output()
	if err != nil {
		return 0, 0, false
	}
	vals := map[string]int{}
	for _, line := range strings.Split(string(out), "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), "=", 2)
		if len(parts) != 2 {
			continue
		}
		n, err := strconv.Atoi(parts[1])
		if err == nil {
			vals[parts[0]] = n
		}
	}
	return vals["X"], vals["Y"], true
}

func screenSize() (w, h int) {
	return 1920, 1080
}

func windowVisible(w fyne.Window) bool {
	return true
}

func x11WindowIDByTitle(title string) string {
	out, err := exec.Command("xdotool", "search", "--name", title).Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		id := strings.TrimSpace(line)
		if id == "" {
			continue
		}
		name, err := exec.Command("xdotool", "getwindowname", id).Output()
		if err == nil && strings.TrimSpace(string(name)) == title {
			return id
		}
	}
	return ""
}
