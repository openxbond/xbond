package main

import (
	"fmt"
	"os"

	"github.com/openxbond/xbond/internal/version"
	"github.com/spf13/cobra"
)

var globalLang string

var rootCmd = &cobra.Command{
	Use:   "xbond",
	Short: "XBond — High performance, next-generation embedded proxy client",
	Long: fmt.Sprintf(`XBond cli v%s (sing-box v%s)
Next-generation proxy client with embedded sing-box engine, dual-track subscriptions, and comprehensive runtime diagnostics.`, version.Version, version.SingBoxVersion),
}

func init() {
	rootCmd.PersistentFlags().StringVar(&globalLang, "lang", "", "Language: zh-HK, zh-CN, en, ko, fa (default auto-detected)")
	rootCmd.AddGroup(
		&cobra.Group{ID: "basic", Title: "Basic commands:"},
		&cobra.Group{ID: "config", Title: "Configuration commands:"},
		&cobra.Group{ID: "observe", Title: "Observation commands:"},
		&cobra.Group{ID: "other", Title: "Other commands:"},
	)
	rootCmd.SetHelpCommandGroupID("other")
	rootCmd.SetCompletionCommandGroupID("other")
	for _, cmd := range rootCmd.Commands() {
		switch cmd.Name() {
		case "login", "logout", "up", "down", "restart", "status":
			cmd.GroupID = "basic"
		case "sub", "update", "mode", "node", "env":
			cmd.GroupID = "config"
		case "logs", "conns", "rules", "dns", "doctor", "bugreport":
			cmd.GroupID = "observe"
		default:
			cmd.GroupID = "other"
		}
	}
}

func main() {
	rootCmd.SilenceUsage = true
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
