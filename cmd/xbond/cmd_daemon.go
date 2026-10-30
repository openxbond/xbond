package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/openxbond/xbond/internal/daemon"
	"github.com/openxbond/xbond/internal/daemon/service"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/version"
	"github.com/spf13/cobra"
)

var (
	webListen        string
	webNoOpen        bool
	versionJSON      bool
	daemonListen     string
	daemonWebDir     string
	daemonBackground bool
	daemonScope      string
)

func init() {
	// daemon — foreground control service plus its service management verbs.
	daemonCmd.PersistentFlags().StringVar(&daemonListen, "listen", "", "LocalAPI listen address (default 127.0.0.1:0 auto-assigned)")
	daemonCmd.PersistentFlags().StringVar(&daemonWebDir, "web-dir", "", "Directory containing compiled web assets (dist)")
	daemonCmd.PersistentFlags().BoolVar(&daemonBackground, "background", false, "Hide the console window (set by the service registration on Windows)")
	daemonInstallCmd.Flags().StringVar(&daemonScope, "scope", string(service.ScopeUser), "Installation scope: user or system")
	daemonCmd.AddCommand(daemonInstallCmd, daemonUninstallCmd, daemonStartCmd, daemonStopCmd, daemonRestartCmd, daemonStatusCmd)
	rootCmd.AddCommand(daemonCmd)

	// web
	webCmd.Flags().StringVar(&webListen, "listen", "127.0.0.1:9099", "Address to serve Web UI bridge")
	webCmd.Flags().BoolVar(&webNoOpen, "no-open", false, "Do not automatically open browser")
	rootCmd.AddCommand(webCmd)

	// version
	versionCmd.Flags().BoolVar(&versionJSON, "json", false, "Output version information as JSON")
	rootCmd.AddCommand(versionCmd)
}

// runDaemon is the foreground control service: LocalAPI, subscriptions,
// preferences, core apply/start-stop, and update scheduling all live here.
// Service registrations supervise this same entry; the program never forks.
func runDaemon(cmd *cobra.Command, args []string) error {
	if daemonBackground {
		hideConsoleWindow()
	}

	webDir := daemonWebDir
	if webDir == "" {
		// Web builds are emitted into the workspace distribution directory.
		if _, err := os.Stat("dist"); err == nil {
			webDir = "dist"
		} else if exe, err := os.Executable(); err == nil {
			candidate := filepath.Join(filepath.Dir(exe), "dist")
			if _, err := os.Stat(candidate); err == nil {
				webDir = candidate
			}
		}
	}

	server, err := daemon.NewServer(daemonListen, webDir)
	if err != nil {
		return fmt.Errorf("failed to start daemon: %w", err)
	}

	fmt.Printf("XBond daemon v%s listening on %s (state dir: %s)\n",
		version.Version, server.Addr(), paths.DataDir())

	serveErr := make(chan error, 1)
	go func() { serveErr <- server.Start() }()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serveErr:
		if err != nil && err != http.ErrServerClosed {
			return fmt.Errorf("daemon server failed: %w", err)
		}
		return nil
	case <-sigChan:
	case <-server.ShutdownRequested():
	}

	// Signal and LocalAPI shutdown converge here: engine down, system proxy
	// restored, credential files removed, listener closed, lock released.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Stop(ctx); err != nil {
		return fmt.Errorf("daemon shutdown incomplete: %w", err)
	}
	return nil
}

var daemonCmd = &cobra.Command{
	Use:   "daemon",
	Short: "Run the XBond control service, or manage its background installation",
	RunE:  runDaemon,
}

var daemonInstallCmd = &cobra.Command{
	Use:   "install",
	Short: "Register the daemon as a background autostart service and start it",
	RunE: func(cmd *cobra.Command, args []string) error {
		selfPath, err := service.SelfPath()
		if err != nil {
			return err
		}
		if err := service.Install(selfPath, service.Scope(daemonScope)); err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := waitDaemonReady(ctx); err != nil {
			return err
		}
		fmt.Println("xbond daemon service installed and started.")
		return nil
	},
}

var daemonUninstallCmd = &cobra.Command{
	Use:   "uninstall",
	Short: "Stop the daemon and remove its autostart registration, keeping user data",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		// Clean the connection first: the daemon exits gracefully (engine
		// down, proxy restored) before its registration disappears.
		if client, err := daemon.NewClient(); err == nil {
			_ = client.Shutdown(ctx)
		}
		if err := service.Uninstall(); err != nil {
			return err
		}
		if err := waitDaemonStopped(ctx, 5*time.Second); err != nil {
			return err
		}
		fmt.Println("xbond daemon service unregistered; user data kept.")
		return nil
	},
}

var daemonStartCmd = &cobra.Command{
	Use:   "start",
	Short: "Start the registered background daemon service",
	RunE: func(cmd *cobra.Command, args []string) error {
		if !service.Installed() {
			return fmt.Errorf("daemon service is not installed; run: xbond daemon install")
		}
		if err := service.Start(); err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := waitDaemonReady(ctx); err != nil {
			return err
		}
		fmt.Println("Daemon service is running.")
		return nil
	},
}

var daemonStopCmd = &cobra.Command{
	Use:   "stop",
	Short: "Stop the background daemon service and wait for its exit",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		// The supervisor's stop is a hard kill on Windows, so ask the daemon
		// to exit gracefully first (engine down, proxy restored).
		if client, err := daemon.NewClient(); err == nil {
			if err := client.Shutdown(ctx); err != nil {
				fmt.Fprintf(os.Stderr, "shutdown request failed (%v); falling back to the supervisor\n", err)
			}
		}
		if err := service.Stop(); err != nil {
			return err
		}
		// Accepted shutdown is not a completed cleanup: confirm the daemon is
		// really gone before reporting success.
		if err := waitDaemonStopped(ctx, 5*time.Second); err != nil {
			return err
		}
		fmt.Println("Daemon service stopped.")
		return nil
	},
}

var daemonRestartCmd = &cobra.Command{
	Use:   "restart",
	Short: "Fully stop the daemon service, then start it again",
	RunE: func(cmd *cobra.Command, args []string) error {
		stopErr := daemonStopCmd.RunE(daemonStopCmd, args)
		if stopErr != nil {
			return fmt.Errorf("stop phase failed: %w", stopErr)
		}
		return daemonStartCmd.RunE(daemonStartCmd, args)
	},
}

var daemonStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Report daemon registration and runtime state separately",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		if client, err := daemon.NewClient(); err == nil {
			if st, err := client.GetStatus(ctx); err == nil {
				fmt.Printf("running (engine active: %v, takeover: %s)\n",
					st.Engine.Running, st.Preferences.TakeoverMode)
				return nil
			}
		}
		if service.Installed() {
			fmt.Println("installed but not responding")
			return nil
		}
		fmt.Println("not installed")
		return nil
	},
}

var webCmd = &cobra.Command{
	Use:   "web",
	Short: "Open local Web UI bridge with auto-configured controller credentials",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		st, err := client.GetStatus(ctx)
		if err != nil {
			return err
		}

		fmt.Printf("Web console bridge is active via daemon on http://%s\n", client.Addr())
		fmt.Printf("Internal Clash API: http://127.0.0.1:%d (secret configured)\n", st.Preferences.ClashPort)

		if !webNoOpen {
			openBrowser(fmt.Sprintf("http://%s/", client.Addr()))
		}
		return nil
	},
}

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print client and sing-box version information",
	RunE: func(cmd *cobra.Command, args []string) error {
		info := version.Get()
		if versionJSON {
			data, _ := json.MarshalIndent(info, "", "  ")
			fmt.Println(string(data))
			return nil
		}
		fmt.Println(version.String())
		return nil
	},
}

func waitDaemonReady(ctx context.Context) (*daemon.Client, error) {
	for {
		if c, err := daemon.NewClient(); err == nil {
			if _, err := c.GetStatus(ctx); err == nil {
				return c, nil
			}
		}
		if ctx.Err() != nil {
			return nil, fmt.Errorf("xbond daemon did not become ready in time; check its logs")
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func waitDaemonStopped(ctx context.Context, timeout time.Duration) error {
	deadline := time.After(timeout)
	for {
		c, err := daemon.NewClient()
		if err == nil {
			if _, err := c.GetStatus(ctx); err != nil {
				return nil
			}
		} else {
			return nil
		}
		select {
		case <-deadline:
			return fmt.Errorf("daemon did not exit within %s; it may still hold the proxy or ports", timeout)
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func openBrowser(targetURL string) error {
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
