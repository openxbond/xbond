# 发布流程

从干净工作树打 tag 起，`node scripts/build-release.ts <vX.Y.Z>` 产出发布目录（`release/<tag>/`）：每个目标一个自包含二进制（Web UI 与 wintun.dll 均已内嵌）、`dashboard.zip`（共享发布工具链打包并校验）与全量 `SHA256SUMS`。版本经 `-ldflags -X` 写入 `internal/version.Version`，`xbond version --json` 可验。

## 目标矩阵与体积（v0.1.0 实测）

| 产物                                | 体积           |
| ----------------------------------- | -------------- |
| xbond-windows-amd64.exe / arm64.exe | 85.6 / 78.1 MB |
| xbond-linux-amd64 / arm64           | 86.1 / 79.8 MB |
| xbond-darwin-amd64 / arm64          | 84.5 / 79.0 MB |
| dashboard.zip                       | 1.6 MB         |

体积主体是双核心（mihomo + sing-box）加嵌入 UI；`-trimpath -ldflags "-s -w"` 已去符号。Android APK 与 daemon 镜像在各自工具链产出（`pnpm mobile:bind:android` + gradle；`Dockerfile`，约 150 MB）。

## 发布通道（约定）

- **二进制**：GitHub Releases——tag 即发布，`release/<tag>/` 目录整体上传，`SHA256SUMS` 随附。
- **Docker 镜像**：`ghcr.io/openxbond/xbond:<tag>`，`docker buildx` 多架构（amd64/arm64）；接入指引见 Cloud 仓库的 `docs/recipes/docker-daemon.md`。
- **Android APK**：应用包名 `net.xbond.app`；发布前用 release 版 `xbond-mobile.aar` 重新 gradle 打包，签名密钥由发布负责人持有（本仓库不含）。
- **页面**：`dashboard.zip` 即守护进程内嵌 UI 的同源形态，也可独立静态发布。

## 许可

XBond 以开源许可分发（LICENSE）。内嵌组件的许可与出处随源码保留：mihomo（GPL-3.0，库方式链接）、sing-box（MIT，vendored 副本含四处补丁，`scripts/patches/` 有逐处说明）、wintun.dll（Wintun 许可，可再分发）、x/mobile 等依赖遵循各自 LICENSE。

## 边界（发布前如实核对）

- Windows 特权服务的提权安装/卸载/停止需一次管理员实机走查（本仓库开发机无管理员会话，负路径已验）。
- Android 真机项（休眠重连、Always-On、电池、按应用分流实测）待实机；iOS PacketTunnel 需要 macOS/Xcode 与 Apple 开发者账号，当前开发环境不具备，未开始。
