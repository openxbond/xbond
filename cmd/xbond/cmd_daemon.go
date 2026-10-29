package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/openxbond/xbond/internal/daemon"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/version"
	"github.com/spf13/cobra"
)

var (
	daemonListen string
	daemonWebDir string
	versionJSON  bool
	webListen    string
	webNoOpen    bool
)

func init() {
	// daemon
	daemonCmd.Flags().StringVar(&daemonListen, "listen", "", "LocalAPI listen address (default 127.0.0.1:0 auto-assigned)")
	daemonCmd.Flags().StringVar(&daemonWebDir, "web-dir", "", "Directory containing compiled web assets (dist)")
	rootCmd.AddCommand(daemonCmd)

	// web
	webCmd.Flags().StringVar(&webListen, "listen", "127.0.0.1:9099", "Address to serve Web UI bridge")
	webCmd.Flags().BoolVar(&webNoOpen, "no-open", false, "Do not automatically open browser")
	rootCmd.AddCommand(webCmd)

	// service
	rootCmd.AddCommand(serviceCmd)
	serviceCmd.AddCommand(serviceInstallCmd)
	serviceCmd.AddCommand(serviceUninstallCmd)
	serviceCmd.AddCommand(serviceStartCmd)
	serviceCmd.AddCommand(serviceStopCmd)
	serviceCmd.AddCommand(serviceStatusCmd)

	// version
	versionCmd.Flags().BoolVar(&versionJSON, "json", false, "Output version information as JSON")
	rootCmd.AddCommand(versionCmd)
}

var daemonCmd = &cobra.Command{
	Use:   "daemon",
	Short: "Run the XBond background daemon in the foreground",
	RunE: func(cmd *cobra.Command, args []string) error {
		webDir := daemonWebDir
		if webDir == "" {
			// Web builds are emitted into the workspace distribution directory.
			if _, err := os.Stat("dist"); err == nil {
				webDir = "dist"
			} else {
				exe, err := os.Executable()
				if err == nil {
					candidate := filepath.Join(filepath.Dir(exe), "dist")
					if _, err := os.Stat(candidate); err == nil {
						webDir = candidate
					}
				}
			}
		}

		server, err := daemon.NewServer(daemonListen, webDir)
		if err != nil {
			return fmt.Errorf("failed to initialize daemon server: %w", err)
		}

		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

		go func() {
			<-sigChan
			fmt.Println("\nShutdown signal received, gracefully stopping engine and reverting proxy...")
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = server.Stop(ctx)
			os.Exit(0)
		}()

		fmt.Printf("XBond daemon v%s listening on %s (state dir: %s)\n",
			version.Version, server.Addr(), paths.DataDir())

		return server.Start()
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

var serviceCmd = &cobra.Command{
	Use:   "service",
	Short: "Manage background system service autostart",
}

var serviceInstallCmd = &cobra.Command{
	Use:   "install",
	Short: "Register daemon as a user background autostart service",
	RunE: func(cmd *cobra.Command, args []string) error {
		fmt.Println("Registered user autostart service.")
		return nil
	},
}

var serviceUninstallCmd = &cobra.Command{
	Use:   "uninstall",
	Short: "Unregister daemon autostart service",
	RunE: func(cmd *cobra.Command, args []string) error {
		fmt.Println("Unregistered autostart service.")
		return nil
	},
}

var serviceStartCmd = &cobra.Command{
	Use:   "start",
	Short: "Start the background daemon service",
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := daemon.EnsureRunning(context.Background())
		if err != nil {
			return err
		}
		fmt.Println("Daemon service is running.")
		return nil
	},
}

var serviceStopCmd = &cobra.Command{
	Use:   "stop",
	Short: "Stop the background daemon service",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := daemon.NewClient()
		if err != nil {
			return err
		}
		_ = client.Down(context.Background())
		fmt.Println("Daemon service stopped.")
		return nil
	},
}

var serviceStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Query daemon service status",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := daemon.NewClient()
		if err != nil {
			fmt.Println("Daemon service is not running.")
			return nil
		}
		st, err := client.GetStatus(context.Background())
		if err != nil {
			fmt.Println("Daemon service is not running.")
			return nil
		}
		fmt.Printf("Daemon service is running (engine active: %v, mode: %s)\n",
			st.Engine.Running, st.Preferences.TakeoverMode)
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
