package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/openxbond/xbond/internal/daemon"
	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/i18n"
	"github.com/spf13/cobra"
)

var (
	upMode     string
	upRouting  string
	upPort     int
	upAllowLan bool
	upSub      string

	modeRouting  string
	modePort     int
	modeAllowLan string

	envShell string
	envUnset bool
)

func init() {
	// up
	upCmd.Flags().StringVar(&upMode, "mode", "", "Traffic takeover mode: sysproxy, tun, port")
	upCmd.Flags().StringVar(&upRouting, "routing", "", "Routing mode: rule, global, direct")
	upCmd.Flags().IntVar(&upPort, "port", 0, "Mixed proxy inbound port (default 7890)")
	upCmd.Flags().BoolVar(&upAllowLan, "allow-lan", false, "Listen on 0.0.0.0 for LAN access")
	upCmd.Flags().StringVar(&upSub, "sub", "", "Subscription name or ID to activate")
	rootCmd.AddCommand(upCmd)

	// down
	rootCmd.AddCommand(downCmd)

	// restart
	rootCmd.AddCommand(restartCmd)

	// mode
	modeCmd.Flags().StringVar(&modeRouting, "routing", "", "Switch routing mode: rule, global, direct")
	modeCmd.Flags().IntVar(&modePort, "port", 0, "Change mixed proxy port")
	modeCmd.Flags().StringVar(&modeAllowLan, "allow-lan", "", "Change LAN access: true, false")
	rootCmd.AddCommand(modeCmd)

	// env
	envCmd.Flags().StringVar(&envShell, "shell", "sh", "Shell type: sh (bash/zsh), fish, pwsh (PowerShell), cmd")
	envCmd.Flags().BoolVar(&envUnset, "unset", false, "Print commands to unset proxy environment variables")
	rootCmd.AddCommand(envCmd)
}

var upCmd = &cobra.Command{
	Use:   "up",
	Short: "Start or reload the embedded sing-box engine",
	Args:  cobra.NoArgs,
	Long: `Connect the core using the active subscription and current preferences.

Repeating ` + "`up`" + ` with unchanged arguments is a no-op — the core is not bounced. Pass options (or ` + "--sub" + `) to apply a change, and use ` + "`xbond restart`" + ` for a full core restart.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		lang := i18n.Resolve(globalLang, "")
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		var allowLanPtr *bool
		if cmd.Flags().Changed("allow-lan") {
			allowLanPtr = &upAllowLan
		}

		if err := client.Up(ctx, engine.TakeoverMode(upMode), engine.RoutingMode(upRouting), upPort, allowLanPtr, upSub); err != nil {
			if strings.Contains(err.Error(), "bind: Only one usage") || strings.Contains(err.Error(), "address already in use") {
				port := upPort
				if port == 0 {
					port = 7890
				}
				return fmt.Errorf("%w\n\n%s: %s\n%s", err, i18n.T(lang, "tag.error"),
					i18n.T(lang, "engine.port_conflict", i18n.P{"port": port}),
					i18n.T(lang, "engine.port_conflict_hint"))
			}
			return err
		}

		st, _ := client.GetStatus(ctx)
		if st != nil {
			fmt.Printf("%s %s\n", i18n.T(lang, "tag.success"), i18n.T(lang, "engine.started", i18n.P{
				"mode": st.Preferences.TakeoverMode, "routing": st.Preferences.RoutingMode, "port": st.Preferences.MixedPort,
			}))
		} else {
			fmt.Printf("%s %s\n", i18n.T(lang, "tag.success"), i18n.T(lang, "engine.started", i18n.P{"mode": upMode, "routing": upRouting, "port": upPort}))
		}
		return nil
	},
}

var downCmd = &cobra.Command{
	Use:   "down",
	Short: "Stop the engine and revert system proxy settings",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		lang := i18n.Resolve(globalLang, "")
		ctx := context.Background()
		client, err := daemon.NewClient()
		if err != nil {
			// A dead daemon owns no running core: down stays idempotent
			// instead of failing.
			fmt.Printf("%s %s\n", i18n.T(lang, "tag.success"), i18n.T(lang, "engine.already_stopped"))
			return nil
		}
		stopped, err := client.Down(ctx)
		if err != nil {
			return err
		}
		if stopped {
			fmt.Printf("%s %s\n", i18n.T(lang, "tag.success"), i18n.T(lang, "engine.stopped"))
		} else {
			fmt.Printf("%s %s\n", i18n.T(lang, "tag.success"), i18n.T(lang, "engine.already_stopped"))
		}
		return nil
	},
}

var restartCmd = &cobra.Command{
	Use:   "restart",
	Short: "Restart the engine with current subscription and preferences",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		lang := i18n.Resolve(globalLang, "")
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}
		if err := client.Restart(ctx); err != nil {
			return err
		}
		fmt.Printf("%s %s\n", i18n.T(lang, "tag.success"), i18n.T(lang, "engine.restarted"))
		return nil
	},
}

var modeCmd = &cobra.Command{
	Use:   "mode [sysproxy|tun|port]",
	Short: "View or change traffic takeover and routing modes",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()

		// Validate arguments before touching the daemon: a typo must fail as
		// a typo, not as "daemon is not running" (and must never start it).
		var targetTakeover engine.TakeoverMode
		if len(args) > 0 {
			targetTakeover = engine.TakeoverMode(args[0])
		}
		var allowLanPtr *bool
		if modeAllowLan != "" {
			val, err := parseStrictBool(modeAllowLan)
			if err != nil {
				return err
			}
			allowLanPtr = &val
		}

		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		if targetTakeover != "" || modeRouting != "" || modePort > 0 || allowLanPtr != nil {
			if err := client.SetMode(ctx, targetTakeover, engine.RoutingMode(modeRouting), modePort, allowLanPtr); err != nil {
				return err
			}
			fmt.Println("Mode preferences updated successfully.")
		}

		st, err := client.GetStatus(ctx)
		if err != nil {
			return err
		}

		fmt.Printf("Takeover Mode: %s\n", st.Preferences.TakeoverMode)
		fmt.Printf("Routing Mode:  %s\n", st.Preferences.RoutingMode)
		fmt.Printf("Mixed Port:    %d\n", st.Preferences.MixedPort)
		fmt.Printf("Allow LAN:     %v\n", st.Preferences.AllowLan)
		return nil
	},
}

var envCmd = &cobra.Command{
	Use:   "env",
	Short: "Output shell proxy export statements for terminal sessions",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		port := 7890
		client, err := daemon.NewClient()
		if err == nil {
			st, err := client.GetStatus(ctx)
			if err == nil && st.Preferences.MixedPort > 0 {
				port = st.Preferences.MixedPort
			}
		}

		addr := fmt.Sprintf("127.0.0.1:%d", port)
		httpURL := fmt.Sprintf("http://%s", addr)
		socksURL := fmt.Sprintf("socks5://%s", addr)

		shell := strings.ToLower(envShell)
		switch shell {
		case "fish":
			if envUnset {
				fmt.Println("set -e http_proxy; set -e https_proxy; set -e all_proxy; set -e HTTP_PROXY; set -e HTTPS_PROXY; set -e ALL_PROXY;")
			} else {
				fmt.Printf("set -gx http_proxy %s; set -gx https_proxy %s; set -gx all_proxy %s;\n", httpURL, httpURL, socksURL)
			}
		case "pwsh", "powershell":
			if envUnset {
				fmt.Println(`$env:http_proxy = ""; $env:https_proxy = ""; $env:all_proxy = ""; $env:HTTP_PROXY = ""; $env:HTTPS_PROXY = ""; $env:ALL_PROXY = "";`)
			} else {
				fmt.Printf("$env:http_proxy = \"%s\"; $env:https_proxy = \"%s\"; $env:all_proxy = \"%s\";\n", httpURL, httpURL, socksURL)
			}
		case "cmd":
			if envUnset {
				fmt.Println("set http_proxy= & set https_proxy= & set all_proxy=")
			} else {
				fmt.Printf("set http_proxy=%s & set https_proxy=%s & set all_proxy=%s\n", httpURL, httpURL, socksURL)
			}
		default: // sh, bash, zsh
			if envUnset {
				fmt.Println("unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY")
			} else {
				fmt.Printf("export http_proxy=%s https_proxy=%s all_proxy=%s HTTP_PROXY=%s HTTPS_PROXY=%s ALL_PROXY=%s\n",
					httpURL, httpURL, socksURL, httpURL, httpURL, socksURL)
			}
		}
		return nil
	},
}
