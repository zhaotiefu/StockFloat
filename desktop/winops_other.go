//go:build !windows

package main

import (
	"os/exec"
	"strconv"
	"strings"

	"fyne.io/fyne/v2"
)

func setWindowOpacity(w fyne.Window, percent int) {
	_ = w
	percent = clampOpacity(percent)
	out, err := exec.Command("xdotool", "search", "--name", "^Stock Float$").Output()
	if err != nil {
		return
	}
	id := strings.TrimSpace(strings.Split(string(out), "\n")[0])
	if id == "" {
		return
	}
	if percent >= 100 {
		_ = exec.Command("xprop", "-id", id, "-remove", "_NET_WM_WINDOW_OPACITY").Run()
		return
	}
	alpha := uint64(float64(percent) / 100.0 * 0xffffffff)
	_ = exec.Command("xprop", "-id", id, "-f", "_NET_WM_WINDOW_OPACITY", "32c",
		"-set", "_NET_WM_WINDOW_OPACITY", strconv.FormatUint(alpha, 10)).Run()
}
