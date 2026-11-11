// Package browser opens the user's default browser on the host platform.
package browser

import (
	"os/exec"
	"runtime"
)

// Open launches targetURL in the platform browser. The call only starts the
// handler process; it does not wait for the browser to load the page.
func Open(targetURL string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", targetURL)
	case "darwin":
		cmd = exec.Command("open", targetURL)
	default:
		cmd = exec.Command("xdg-open", targetURL)
	}
	return cmd.Start()
}
