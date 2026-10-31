package version

import (
	"fmt"
	"runtime"
)

const (
	Version     = "0.1.0"
	CoreVersion = "1.19.33"
	ClientName  = "xbond"
)

type Info struct {
	ClientVersion string `json:"clientVersion"`
	CoreVersion   string `json:"coreVersion"`
	OS            string `json:"os"`
	Arch          string `json:"arch"`
	GoVersion     string `json:"goVersion"`
}

func Get() Info {
	return Info{
		ClientVersion: Version,
		CoreVersion:   CoreVersion,
		OS:            runtime.GOOS,
		Arch:          runtime.GOARCH,
		GoVersion:     runtime.Version(),
	}
}

func String() string {
	return fmt.Sprintf("%s v%s (mihomo v%s, %s/%s)", ClientName, Version, CoreVersion, runtime.GOOS, runtime.GOARCH)
}
