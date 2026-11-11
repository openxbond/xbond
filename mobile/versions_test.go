package mobile

import (
	"strings"
	"testing"

	mihomoConstant "github.com/metacubex/mihomo/constant"
	singboxConstant "github.com/sagernet/sing-box/constant"
)

// 庫編譯拿不到核心自己的 ldflags 版本注入，init 必須從模組依賴把版本補上，
// 否則核心 /version 會回報 "unknown"（sing-box）或 "1.10.0"（mihomo 佔位）。
func TestCoreVersionsFilledFromBuildInfo(t *testing.T) {
	if singboxConstant.Version == "" || singboxConstant.Version == "unknown" {
		t.Fatalf("sing-box version not resolved from build info: %q", singboxConstant.Version)
	}
	if strings.HasPrefix(singboxConstant.Version, "v") {
		t.Fatalf("sing-box version keeps the go.mod v-prefix: %q", singboxConstant.Version)
	}
	if mihomoConstant.Version == "" || mihomoConstant.Version == "1.10.0" {
		t.Fatalf("mihomo version not resolved from build info: %q", mihomoConstant.Version)
	}
	if strings.HasPrefix(mihomoConstant.Version, "v") {
		t.Fatalf("mihomo version keeps the go.mod v-prefix: %q", mihomoConstant.Version)
	}
}
