//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"

	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/upgrade"
	"github.com/spf13/cobra"
)

func quietUpgradeCommand(*exec.Cmd) {}

func renameUpgradeBinary(source, target string) error {
	return os.Rename(source, target)
}

func installCLIUpdate(cmd *cobra.Command, target, staged, next, _ string) error {
	defer os.Remove(staged)
	release, err := upgrade.Lock(paths.DataDir())
	if err != nil {
		return err
	}
	defer release()
	if err := replaceManagedBinary(target, staged, next, false); err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "XBond %s is installed.\n", next)
	return reportMachineUpgrade(cmd, target, next)
}
