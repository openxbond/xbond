package version

import (
	"fmt"
	"runtime"
)

const (
	Version        = "0.1.0"
	CoreVersion    = "1.19.33"
	SingBoxVersion = "1.13.21"
	ClientName     = "xbond"
)

type Info struct {
	ClientVersion  string `json:"clientVersion"`
	CoreVersion    string `json:"coreVersion"`
	SingBoxVersion string `json:"singBoxVersion"`
	OS             string `json:"os"`
	Arch           string `json:"arch"`
	GoVersion      string `json:"goVersion"`
}

func Get() Info {
	return Info{
		ClientVersion:  Version,
		CoreVersion:    CoreVersion,
		SingBoxVersion: SingBoxVersion,
		OS:             runtime.GOOS,
		Arch:           runtime.GOARCH,
		GoVersion:      runtime.Version(),
	}
}

func String() string {
	return fmt.Sprintf("%s v%s (mihomo v%s, sing-box v%s, %s/%s)", ClientName, Version, CoreVersion, SingBoxVersion, runtime.GOOS, runtime.GOARCH)
}
