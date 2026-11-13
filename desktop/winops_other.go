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
	id := firstWindowID("^Stock Float")
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

func setAlwaysOnTop(w fyne.Window, on bool) {
	_ = w
	id := firstWindowID("^Stock Float")
	if id == "" {
		return
	}
	setNetWMState(id, on, "_NET_WM_STATE_ABOVE")
}

func setSkipTaskbar(w fyne.Window, skip bool) {
	_ = w
	id := firstWindowID("^Stock Float")
	if id == "" {
		return
	}
	setNetWMState(id, skip, "_NET_WM_STATE_SKIP_TASKBAR")
}

func hideAuxiliaryTaskbarWindows() {
	id := firstWindowID("SystrayMonitor")
	if id == "" {
		return
	}
	setNetWMState(id, true, "_NET_WM_STATE_SKIP_TASKBAR")
	_ = exec.Command("xdotool", "windowunmap", id).Run()
	_ = exec.Command("xdotool", "set_window", "--name", "", id).Run()
}

func setNetWMState(id string, enable bool, atom string) {
	out, _ := exec.Command("xprop", "-id", id, "_NET_WM_STATE").Output()
	line := strings.TrimSpace(string(out))
	states := map[string]bool{}
	if idx := strings.Index(line, "="); idx >= 0 {
		for _, part := range strings.Split(line[idx+1:], ",") {
			a := strings.TrimSpace(part)
			if a != "" && a != "not found." {
				states[a] = true
			}
		}
	}
	if enable {
		states[atom] = true
	} else {
		delete(states, atom)
	}
	if len(states) == 0 {
		_ = exec.Command("xprop", "-id", id, "-remove", "_NET_WM_STATE").Run()
		return
	}
	vals := make([]string, 0, len(states))
	for a := range states {
		vals = append(vals, a)
	}
	_ = exec.Command("xprop", "-id", id, "-f", "_NET_WM_STATE", "32a",
		"-set", "_NET_WM_STATE", strings.Join(vals, ", ")).Run()
}

func firstWindowID(name string) string {
	out, err := exec.Command("xdotool", "search", "--name", name).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(strings.Split(string(out), "\n")[0])
}
