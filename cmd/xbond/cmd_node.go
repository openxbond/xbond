package main

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/openxbond/xbond/daemon"
	"github.com/spf13/cobra"
)

var (
	nodeListJSON bool
	nodeTestURL  string
	nodeTestTO   int
	nodeTestJSON bool
)

func init() {
	rootCmd.AddCommand(nodeCmd)

	// node list
	nodeListCmd.Flags().BoolVar(&nodeListJSON, "json", false, "Output as JSON")
	nodeCmd.AddCommand(nodeListCmd)

	// node select
	nodeCmd.AddCommand(nodeSelectCmd)

	// node test
	nodeTestCmd.Flags().StringVar(&nodeTestURL, "url", "https://www.gstatic.com/generate_204", "URL for latency testing")
	nodeTestCmd.Flags().IntVar(&nodeTestTO, "timeout", 5000, "Timeout in milliseconds")
	nodeTestCmd.Flags().BoolVar(&nodeTestJSON, "json", false, "Output as JSON")
	nodeCmd.AddCommand(nodeTestCmd)
}

var nodeCmd = &cobra.Command{
	Use:   "node",
	Short: "Inspect, switch, and test strategy groups and proxy nodes",
}

var nodeListCmd = &cobra.Command{
	Use:   "list [group]",
	Short: "List proxy groups or nodes within a group",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		proxies, err := client.GetNodes(ctx)
		if err != nil {
			return err
		}

		if nodeListJSON {
			data, _ := json.MarshalIndent(proxies, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		if len(args) > 0 {
			targetGroup := args[0]
			group, exists := proxies[targetGroup]
			if !exists {
				return fmt.Errorf("group %q not found", targetGroup)
			}

			fmt.Printf("Nodes in group: %s (selected: %s)\n", group.Name, group.Now)
			fmt.Println(strings.Repeat("-", 60))
			for _, nodeName := range group.All {
				selected := " "
				if nodeName == group.Now {
					selected = "*"
				}
				delayStr := "N/A"
				if nodeItem, ok := proxies[nodeName]; ok && len(nodeItem.History) > 0 {
					last := nodeItem.History[len(nodeItem.History)-1]
					if last.Delay > 0 {
						delayStr = fmt.Sprintf("%d ms", last.Delay)
					}
				}
				nodeType := "Node"
				if nodeItem, ok := proxies[nodeName]; ok {
					nodeType = nodeItem.Type
				}
				fmt.Printf("%-2s %-30s %-12s %-10s\n", selected, truncate(nodeName, 30), nodeType, delayStr)
			}
			return nil
		}

		// List groups
		fmt.Printf("%-30s %-10s %-25s %-6s\n", "STRATEGY GROUP", "TYPE", "CURRENT SELECTION", "NODES")
		fmt.Println(strings.Repeat("-", 75))

		var groupNames []string
		for name, item := range proxies {
			if item.Type == "Selector" || item.Type == "URLTest" {
				groupNames = append(groupNames, name)
			}
		}
		sort.Strings(groupNames)

		for _, name := range groupNames {
			g := proxies[name]
			fmt.Printf("%-30s %-10s %-25s %-6d\n",
				truncate(g.Name, 30), g.Type, truncate(g.Now, 25), len(g.All))
		}
		return nil
	},
}

var nodeSelectCmd = &cobra.Command{
	Use:   "select <group> <node>",
	Short: "Select an outbound node for a strategy group",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		group, node := args[0], args[1]
		if err := client.SelectNode(ctx, group, node); err != nil {
			return err
		}
		fmt.Printf("Selected node %q for group %q (saved to subscription memory).\n", node, group)
		return nil
	},
}

var nodeTestCmd = &cobra.Command{
	Use:   "test [group|node]",
	Short: "Test latency of a proxy node or all nodes in a group",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		proxies, err := client.GetNodes(ctx)
		if err != nil {
			return err
		}

		target := "Proxy"
		if len(args) > 0 {
			target = args[0]
		}

		var targetsToTest []string
		if item, exists := proxies[target]; exists && (item.Type == "Selector" || item.Type == "URLTest") {
			targetsToTest = item.All
		} else if _, exists := proxies[target]; exists {
			targetsToTest = []string{target}
		} else {
			// Find default group
			for _, item := range proxies {
				if item.Type == "Selector" {
					targetsToTest = item.All
					break
				}
			}
		}

		if len(targetsToTest) == 0 {
			return fmt.Errorf("no nodes found to test")
		}

		type TestResult struct {
			Node  string `json:"node"`
			Delay int    `json:"delay"`
			Error string `json:"error,omitempty"`
		}

		results := make([]TestResult, 0, len(targetsToTest))
		for _, nodeName := range targetsToTest {
			delay, err := client.TestNode(ctx, nodeName, nodeTestURL, nodeTestTO)
			if err != nil {
				results = append(results, TestResult{Node: nodeName, Delay: -1, Error: err.Error()})
			} else {
				results = append(results, TestResult{Node: nodeName, Delay: delay})
			}
		}

		if nodeTestJSON {
			data, _ := json.MarshalIndent(results, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		sort.Slice(results, func(i, j int) bool {
			if results[i].Delay <= 0 {
				return false
			}
			if results[j].Delay <= 0 {
				return true
			}
			return results[i].Delay < results[j].Delay
		})

		fmt.Printf("%-35s %-12s\n", "NODE", "LATENCY")
		fmt.Println(strings.Repeat("-", 50))
		for _, r := range results {
			delayStr := "Timeout"
			if r.Delay > 0 {
				delayStr = fmt.Sprintf("%d ms", r.Delay)
			}
			fmt.Printf("%-35s %-12s\n", truncate(r.Node, 35), delayStr)
		}
		return nil
	},
}
