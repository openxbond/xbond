package version

import (
	"fmt"
	"runtime"
)

const (
	Version        = "0.1.0"
	SingBoxVersion = "1.13.21"
	ClientName     = "xbond"
)

type Info struct {
	ClientVersion  string `json:"clientVersion"`
	SingBoxVersion string `json:"singBoxVersion"`
	OS             string `json:"os"`
	Arch           string `json:"arch"`
	GoVersion      string `json:"goVersion"`
}

func Get() Info {
	return Info{
		ClientVersion:  Version,
		SingBoxVersion: SingBoxVersion,
		OS:             runtime.GOOS,
		Arch:           runtime.GOARCH,
		GoVersion:      runtime.Version(),
	}
}

func String() string {
	return fmt.Sprintf("%s v%s (sing-box v%s, %s/%s)", ClientName, Version, SingBoxVersion, runtime.GOOS, runtime.GOARCH)
}
