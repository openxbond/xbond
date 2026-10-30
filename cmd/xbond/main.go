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

// commandLayout is both the help grouping and the order inside each group:
// --help follows the workflow these lists spell out instead of the alphabet.
// Cobra sorts subcommands by name, so sorting is disabled below and commands
// are re-registered in layout order.
var commandLayout = []struct {
	group string
	names []string
}{
	{"basic", []string{"login", "logout", "up", "down", "restart", "status"}},
	{"config", []string{"sub", "update", "mode", "node", "env"}},
	{"observe", []string{"logs", "conns", "rules", "dns", "doctor", "bugreport"}},
	// help and completion are created by cobra at Execute time; they follow
	// the listed commands automatically.
	{"other", []string{"daemon", "service", "web", "version"}},
}

func init() {
	cobra.EnableCommandSorting = false
	rootCmd.PersistentFlags().StringVar(&globalLang, "lang", "", "Language: zh-HK, zh-CN, en, ko, fa (default auto-detected)")
	rootCmd.AddGroup(
		&cobra.Group{ID: "basic", Title: "Basic commands:"},
		&cobra.Group{ID: "config", Title: "Configuration commands:"},
		&cobra.Group{ID: "observe", Title: "Observation commands:"},
		&cobra.Group{ID: "other", Title: "Other commands:"},
	)
	rootCmd.SetHelpCommandGroupID("other")
	rootCmd.SetCompletionCommandGroupID("other")

	// Registration happens in per-file init order (alphabetical by file name),
	// which has nothing to do with the help order; re-append by the layout.
	registered := append([]*cobra.Command(nil), rootCmd.Commands()...)
	byName := make(map[string]*cobra.Command, len(registered))
	for _, cmd := range registered {
		byName[cmd.Name()] = cmd
	}
	rootCmd.RemoveCommand(registered...)

	listed := make(map[string]bool, len(registered))
	for _, entry := range commandLayout {
		for _, name := range entry.names {
			cmd, ok := byName[name]
			if !ok {
				continue
			}
			cmd.GroupID = entry.group
			rootCmd.AddCommand(cmd)
			listed[name] = true
		}
	}
	// Everything the layout does not list stays in "other", after the groups.
	for _, cmd := range registered {
		if listed[cmd.Name()] {
			continue
		}
		cmd.GroupID = "other"
		rootCmd.AddCommand(cmd)
	}
}

func main() {
	rootCmd.SilenceUsage = true
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
