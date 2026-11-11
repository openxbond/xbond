package mobile

import (
	"runtime/debug"
	"strings"

	mihomoConstant "github.com/metacubex/mihomo/constant"
	singboxConstant "github.com/sagernet/sing-box/constant"
)

// 兩個核心的版本號平常靠二進制構建的 ldflags 注入；以庫形態編進 AAR 時
// 拿不到（build info 指向宿主模組），核心的 /version 會回報 "unknown"
// （sing-box）或過期佔位（mihomo）。init 時從模組依賴把 pin 的版本補上，
// 讓移動端的版本顯示與桌面一致。
func init() {
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		return
	}
	for _, dep := range bi.Deps {
		switch dep.Path {
		case "github.com/metacubex/mihomo":
			mihomoConstant.Version = strings.TrimPrefix(dep.Version, "v")
		case "github.com/sagernet/sing-box":
			singboxConstant.Version = strings.TrimPrefix(dep.Version, "v")
		}
	}
}
