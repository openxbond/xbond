package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/openxbond/xbond/internal/daemon"
	"github.com/openxbond/xbond/internal/engine"
	"github.com/spf13/cobra"
)

var runConfig string

var runCmd = &cobra.Command{
	Use:   "run",
	Short: "Run a proxy core in the foreground from an explicit config",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()

		// A running daemon owns this machine's takeover (ports, TUN, system
		// proxy); two owners must never silently fight over it.
		if client, err := daemon.NewClient(); err == nil {
			if st, err := client.GetStatus(ctx); err == nil && st.Engine.Running {
				return fmt.Errorf("the xbond daemon already owns a running core; stop it first (xbond down) or use the daemon")
			}
		}

		if _, err := os.Stat(runConfig); err != nil {
			return fmt.Errorf("config file %s: %w", runConfig, err)
		}
		data, err := os.ReadFile(runConfig)
		if err != nil {
			return fmt.Errorf("failed to read config: %w", err)
		}
		if err := engine.Validate(data); err != nil {
			return fmt.Errorf("invalid config: %w", err)
		}

		core := engine.NewManager(1000)
		if err := core.Start(data); err != nil {
			return fmt.Errorf("failed to start core: %w", err)
		}

		fmt.Printf("Core running from %s. Press Ctrl+C to stop.\n", runConfig)
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
		<-sigChan

		// Release what this process owns: listeners and any TUN inbound the
		// config declared. System proxy is never touched in run mode.
		if err := core.Stop(); err != nil {
			return fmt.Errorf("core shutdown incomplete: %w", err)
		}
		return nil
	},
}

func init() {
	runCmd.Flags().StringVar(&runConfig, "config", "", "Path to the sing-box runtime config (required)")
	_ = runCmd.MarkFlagRequired("config")
	rootCmd.AddCommand(runCmd)
}
