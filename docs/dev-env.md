# 開發環境依賴

按變更範圍準備:Web 與 Go 工作只需基本要求;桌面殼另需 Rust 與平台建置依賴;移動端原生接入另需目標平台工具鏈。版本以根 `package.json`、`go.mod`、`src-tauri/Cargo.toml` 為準。

## 基本要求(所有工作)

- pnpm,按根 `package.json` 的 `packageManager`;Node ≥ 24(`scripts/*.ts` 直接執行)。
- Go,按 `go.mod`。
- `pnpm install --frozen-lockfile` 安裝 npm 依賴。

## 桌面(Tauri)

`pnpm desktop`、`pnpm desktop:check` 與 `pnpm desktop:compile` 需要 Rust stable(rustup)及平台建置依賴。缺失的典型症狀:cargo 編譯 `soup3-sys`、`javascriptcore-rs-sys` 等 `-sys` crate 時 pkg-config 報 `Package ... was not found`。

`pnpm desktop` 另一前提:首次開發運行前先 `pnpm cli:build`,桌面殼在 `dist/cli/` 找 `xbond` CLI 來註冊並啟動本機服務;CLI 缺失時殼會輸出指引,介面停留在本機服務未連線狀態。本機服務已安裝並運行時不需要。

| 環境 | 安裝 |
| --- | --- |
| Debian/Ubuntu | `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev` |
| Fedora | `sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel libxdo-devel`,另 `sudo dnf group install "c-development"` |
| Arch | `sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg xdotool` |
| openSUSE | `sudo zypper in webkit2gtk3-devel libopenssl-devel curl wget file libappindicator3-1 librsvg-devel`,另 `sudo zypper in -t pattern devel_basis` |
| macOS | Xcode;只做桌面可用 Command Line Tools(`xcode-select --install`) |
| Windows | Microsoft C++ Build Tools,勾選「使用 C++ 的桌面開發」工作負載;WebView2 在 Windows 10 1803+ 已內置 |

Linux 發行版命令取自 [Tauri v2 前置依賴](https://v2.tauri.app/start/prerequisites/);Ubuntu 26.04 已核對 `libsoup-3.0`、`javascriptcoregtk-4.1`、`webkit2gtk-4.1` 均由 `libwebkit2gtk-4.1-dev` 提供。Linux 上安裝後可用 `pkg-config --exists webkit2gtk-4.1` 自檢。正式安裝包的格式、輸出位置與簽名設定見[發佈手冊](release.md)。

## 移動端

- `pnpm mobile:check` 只驗證 Go 接口,僅需 Go。
- Android:構建 AAR 與 APK 另需 Android SDK(含 NDK,`ANDROID_HOME`/`NDK_HOME`)、gomobile(`pnpm mobile:ensure`)與 Rust 的四個 Android target;`ANDROID_HOME` 按環境變量與 `~/Android/Sdk`、`~/.local/android` 探測。開發宿主 Linux 上可用 Waydroid 做裝置驗證(session 運行時 `pnpm mobile:*` 自動 `adb connect`),AVD 為回退;契約與 gen 手改清單見 [Android 宿主規格](specs/mobile-android.md)。
- iOS 需 macOS、Xcode、XcodeGen、CocoaPods、Rust 的 iOS targets 及 gomobile。首次執行 `pnpm mobile:ensure`、`pnpm mobile:bind:ios`，再用 `pnpm mobile:ios` 啟動標準 Tauri 開發流程。正式歸檔需要 iOS 26 SDK 或以上，以及 App 和 PacketTunnel 各自的簽名描述檔。未在目標平台驗證的能力按[驗證矩陣](agents/verification.md)保留待驗證狀態。

iOS 的 Xcode 工程提交在 `src-tauri/gen/apple/`。修改 `project.yml` 後，在 macOS 執行 `xcodegen generate --spec src-tauri/gen/apple/project.yml` 並提交同步的工程檔。重新執行 `pnpm tauri ios init` 時，保留 PacketTunnel target、App Group、Network Extension entitlements、深鏈、回環網路設定及 XBond AppIcon。
