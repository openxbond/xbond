# Android 宿主（Tauri 殼）

**狀態**：殼層已遷移到 Tauri 2 官方路徑（2026-11-11）：單一 `src-tauri` crate 同時承載桌面與移動（`--features desktop` 門控桌面能力），移動原生能力全部走 `tauri-plugin-xbond` 插件（`plugins/xbond/`），WebView 加載打包資產（tauri 協議）而非本機 LocalAPI 頁面。debug APK 構建通過（`pnpm tauri android build`，net.xbond.app 身份、gomobile AAR 與 Tauri 運行時同包）。歷史驗收（MOB-05～MOB-15）記錄了 fd 交接、雙核心、LocalAPI 契約與 TUN 假成功排查的原始證據；殼層替換後，UI 全循環、深鏈、分應用與插件命令面**須在模擬器重新走查**（見「殼層重驗」），真機項仍待驗。

## 範圍與入口

- **應用殼**：根 `src-tauri/`（crate `xbond-app`）。`run()` 按 feature 分流：`desktop` feature 註冊托盤／單實例／自動啟動／全局快捷鍵／更新器；移動面（默認 features）只註冊 `deep-link`、`opener`、`xbond` 插件，窗口由生成的原生 Activity 承載。
- **插件**：`plugins/xbond/`——Rust crate（命令面 + `permissions/default.toml`）+ Android 庫模塊（Kotlin：`XbondPlugin`、`XbondVpnService`、`XbondTileService`、`SplitTunnelPrefs`、`AppUpdates`、`UpdatesFileProvider`）+ iOS Swift 包（`XbondPlugin.swift` 等，見 iOS 切片）。gomobile AAR 由 `pnpm mobile:bind:android` 產出到 `plugins/xbond/android/libs/xbond-mobile.aar`（全 Android 架構）。
- **生成工程**：`src-tauri/gen/android/`（`pnpm tauri android init` 產物，提交進倉）。包名 `net.xbond.app`；gen 內手改見「gen 再生成清單」。
- **平台分工**：Kotlin 擁有權限申請、TUN 構建（地址／路由／分應用分流）、前台通知與 `protect()`；Go 側（gomobile `mobile.TunnelService`）擁有核心生命週期、按訂閱格式的雙核心選擇與派生。UI 由 Tauri 從打包資產供給（`tauri://localhost`），數據面走進程內 LocalAPI（僅回環、token 鑑權）。

## 插件命令面（取代舊 `window.XBondAndroid` JS 橋）

前端經 `invoke("plugin:xbond|<command>")` 調用（`packages/client-ui/src/platform/android-bridge.ts` 保持導出函數名）：

| 命令 | Kotlin `@Command` | 職責 |
| --- | --- | --- |
| `get_localapi_config` | `getLocalAPIConfig` | 讀 filesDir 的 `localapi.addr`／`localapi.token`；未就緒時 reject，UI 連接核重試 |
| `list_installed_apps` | `listInstalledApps` | 分應用選擇器（排除自身與無 INTERNET 權限包） |
| `get_split_tunnel_config`／`set_split_tunnel_config` | 同名 | SharedPreferences 讀寫；保存後 `XBondVpnService.reloadIfConnected()` 熱重建 |
| `check_for_updates` | `checkForUpdates` | 手動更新檢查（`AppUpdates`，異步彈窗安裝流） |
| `get_preference`／`set_preference` | 同名 | UI 鍵值持久化 |
| `sync_system_bars` | `syncSystemBars` | 系統欄隨主題同步：圖標明暗＋欄色＋視窗背景（Android 15+ edge-to-edge 下欄色是 no-op，透明欄露出的是視窗背景，必須一併上色）。顏色取 `theme-color` meta，須與 `tokens.css` 的 `--background` 十六進制一致 |
| `deliver_account_callback` | `deliverAccountCallback` | OAuth code/state POST `/localapi/v0/account/callback`（8×500ms 重試） |

外部鏈接統一走 `plugin:opener|open_url`；深鏈走 `tauri-plugin-deep-link`（`deep-link://new-url` 事件 → `packages/client-ui/src/platform/deep-links.ts` 路由導入／導航，callback 類型調 `deliver_account_callback` 後派發既有 `xbond-account-updated` 事件）。偏好持久化在 tauri 協議固定源下由 localStorage 承擔（舊殼的隨機端口源已消失）。

## 行為契約（平台側不變量）

### fd 交接與生命週期

1. **prepare**：UI 啟動前經 `XBondVpnService.prepare(context)` 取得授權意圖（非空 = 先請求權限）；服務不自行繞過。
2. **啟動**：LocalAPI `/up` → PlatformBridge `requestConnect()` 同步建立 VPN（需要同意時拋錯、LocalAPI 答 409、系統對話框浮在應用上）→ 構建 TUN（`172.19.0.1/30`、`198.18.0.1/30`、`fdfe:dcba:9876::1/126`、DNS `172.19.0.2`、默認路由、MTU 1500）→ `establish()` → 前台通知常駐（`systemExempted`）→ fd 以 `dup().detachFd()` 交給 `TunnelService.startActive(fd)`——核心讀寫 dup，平台保留原件，任何一側不雙關閉。
3. **粘性恢復**：`START_STICKY`；進程被殼後系統以空 intent 重啟時只拉回服務與 LocalAPI（UI 或磁貼再經 `/up` 重建隧道）。`onRevoke`（撤權或他方 VPN 接管）清空配置並完整拆除。
4. **停止**：`/down` → `requestDisconnect()` 先 `TunnelService.Stop()` 再關接口、移除通知；服務本身存活（UI 存續期間 LocalAPI 保持可用）；`ACTION_STOP` 與 `onRevoke` 完整收縮。

### 進程內 LocalAPI 與移動運行時

應用進程內嵌守護進程同契約的 LocalAPI（`mobile/server.go`，僅回環、token 鑑權，token 落 `localapi.token`、端口落 `localapi.addr`；**靜態資產服務已移除**——UI 由 Tauri 資產供給，LocalAPI 純數據面）。CORS `*` 保留（`tauri android dev` 的 Vite 頁面跨域直連模擬器內 LocalAPI）。路由契約與守護進程對齊（profiles/subs/override/mixin/source/versions/rules/page/connections/`POST /account/callback` 全部可用）。移動運行時（`mobile/runtime.go`）在派生前合併分流層，override/mixin/源編輯與回滾在隧道運行時熱重載——平台 fd 保持有效，系統 VPN 圖標不閃爍。

**OAuth scheme 登錄**（與桌面同契約）：登入請求帶 `callbackScheme: "xbond"`，瀏覽器完成授權後 302 到 `xbond://callback?code&state`，OS 深鏈跳回 App；deep-link 插件以 `deep-link://new-url` 事件交給前端，前端調 `deliver_account_callback`（短重試 8×500ms，覆蓋 LocalAPI 未就緒窗口）後派發 `xbond-account-updated`——深鏈 query 是憑據，日誌只記 scheme/host。

### 分流與重載

- **分應用代理**持久化在 `SplitTunnelPrefs`（SharedPreferences `xbond_vpn_prefs`）：`mode` = `all`（默認）| `disallow`（黑名單）| `allow`（白名單）。`buildVpnInterface` 讀取該配置；**應用自身在所有模式下恆被排除**（核心出站、更新下載、雲同步必須走物理網）。`listInstalledApps` 供選擇器。
- **TUN 采纳链**（歷史實測，不變量）：`auto-route=false` 且 `auto-detect-interface=false`；TUN 網段地址必須掛接口（fake-ip 段首 + IPv6 對應）；`stack: gvisor`；DNS 引導解析用純 IP `default-nameserver`。任一不成立都是靜默假成功——`/configs` 的 `tun.enable` 是判定真相。
- **運行中換配置**：`XBondVpnService.reloadIfConnected()`（`set_split_tunnel_config` 保存後觸發）先建新接口，成功後停核心、換接口、走 `/up` 同一 runtime apply 路徑重啟核心；失敗回滾，系統 VPN 圖標全程不消失。
- **核心 controller 端點進程內固定**（`mobileRuntime.baseEndpoint`）與 **controllerProxy**（24191 穩定前、WebSocket 跨重載）不變；UI 從 status preferences 讀端點，不依賴頁面 meta 注入。

### 自我更新（`AppUpdates`）

release 包帶 `BuildConfig.RELEASE_PUBLIC_KEY`（gradle 環境變量 `XBOND_RELEASE_PUBLIC_KEY`，由插件模塊編入；dev 包為空、手動檢查提示開發版）。更新流：拉 `https://openxbond.github.io/xbond/release.json` → minisign 驗簽（gomobile `Mobile.verifyReleaseSignature`）→ build number 必須等於 `major*10000+minor*100+patch` → 下載 `android-universal` APK（SHA-256、重定向域白名單、包身份與簽名者證書逐項校驗）→ 未知來源授權（插件 `onResume` 續接，等同舊 `onActivityResult`）→ FileProvider（`${applicationId}.updates`）→ 包安裝 intent。發佈管線（CI）以外部 apksigner 簽名後 `release-android.ts` 校驗同一身份，見 `docs/release.md`。

## gen 再生成清單

`tauri android init` 重新生成 `gen/android` 會覆蓋以下手改，按清單重放（也見 `docs/tasks/tauri-mobile.md`）：

1. `app/src/main/AndroidManifest.xml`：`android:roundIcon`、`android:networkSecurityConfig="@xml/network_security_config"`、`android:theme="@style/Theme.XBond"`（插件庫資源）、activity `windowSoftInputMode="adjustResize"`、`xbond`/`clash`/`sing-box` 的 BROWSABLE intent-filter。
2. `app/build.gradle.kts`：`versionName`=`XBOND_VERSION`、`versionCode`=`XBOND_BUILD_NUMBER`（回退 `tauri.properties`）。
3. `app/src/main/java/net/xbond/app/MainActivity.kt`：`onWebViewCreate` 捕獲 WebView + `onBackPressed`（先求值 `window.__xbondHandleBack`，未處理則 `moveTaskToBack(true)`）。不加 `enableEdgeToEdge()`：Android 14 及以下 WebView 的 `env(safe-area-inset-*)` 恆為 0，內容會鑽到狀態欄下；15+ 系統本就強制 edge-to-edge。
4. 啟動圖標資源（`res/mipmap-*`、`drawable/ic_launcher_*`、`values/ic_launcher_background.xml`，來源 `scripts/build-logo-assets.ts` 測試斷言）；刪除模板殘留（`values/colors.xml`、模板主題、layout）。

插件側（`plugins/xbond/android/`）在 gen 之外，再生成不受影響。

## 開發與運行命令

- `pnpm mobile:dev`：標準 `tauri android dev` 迴圈——腳本只負責拉起 AVD（無在線設備時，優先 `Medium_Phone_API_37.0`）、確保 AAR 已綁、`adb reverse tcp:1421`（CLI 不感知設備），隨後交給 Tauri CLI：`beforeDevCommand` 起 Vite（127.0.0.1:1421）→ 構建 debug APK → 安裝並以 devUrl 啟動。Vite HMR 直達 WebView；LocalAPI 憑據經 `get_localapi_config` 插件命令送達，`dev_url` 機制已刪除。Ctrl-C 清理 reverse。
- `pnpm mobile:android`：`tauri android build --debug --apk --target <abi>`（ABI 取自設備 `ro.product.cpu.abi`）→ `adb install -r` 打包 APK → 拉起，驗證最終獨立發版包體驗。
- `pnpm mobile:bind:android`：gomobile bind 全架構 AAR 到插件目錄（`cmfa` build tag 見下）。
- Rust 兩態檢查：`cargo check --manifest-path src-tauri/Cargo.toml --features desktop`（桌面）與不帶 features（移動面，含 `compile_error!` 守衛——桌面構建漏 feature 會大聲失敗）。

### 構建與依賴（原生模塊接入）

**mihomo v1.19.33** 與 **sing-box v1.13.21** 均直接引用上游模塊（無 vendored 副本、無 `replace`）：

- **mihomo Android 嵌入（`cmfa` build tag）**：`scripts/mobile.ts` 在 Android bind 時傳入 `MOBILE_ANDROID_TAGS`（`with_gvisor,with_quic,with_utls,with_clash_api,cmfa`），啟用上游內建的 Android VPN 宿主嵌入模式（跳過 SELinux 禁止的 `/data/system/packages.xml` 直讀與 netlink 監聽，分應用由平台 `VpnService` 承擔）。
- **sing-box 移動端接入（`adapter.PlatformInterface`）**：`NewBoxContext()` 經 `OpenInterface` 注入平台 VPN fd、`CreateDefaultInterfaceMonitor` 提供非 nil 空監視器、日誌訂閱使 `cache_file.enabled=false` 原生生效；`go:linkname` 補齊被內聯消除的 `http2` 符號，消除 `gomobile bind` 重定位錯誤（`internal/engine/tun_fd.go`）。

## 驗收條件

歷史行為驗收（fd 交接、雙核心、LocalAPI 契約、TUN 端到端）見任務記錄 `docs/tasks/tauri-mobile.md` 與 MOB-01～MOB-15 存檔；平台側代碼未動，契約持續。殼層替換後的新面驗收：

| 編號 | 結果 | 驗證入口 |
| --- | --- | --- |
| MOB-16 | 單一 crate 兩態編譯：`--features desktop`（托盤／更新器）與無 features（移動面，`#[tauri::mobile_entry_point]`）通過；桌面漏 feature 大聲失敗 | `cargo check` ×3（desktop / 移動面 aarch64-linux-android / 插件 crate）（2026-11-11 通過） |
| MOB-17 | debug APK 構建：`pnpm tauri android build --debug --apk --target aarch64` 產出 `net.xbond.app`（versionCode 由 `tauri.properties`，release 由 `XBOND_BUILD_NUMBER`），包內 `libgojni.so`（gomobile）+ `libxbond_app_lib.so`（Tauri 運行時）同包 | aapt badging + unzip（2026-11-11 通過） |
| MOB-18 | 插件命令面上機：`get_localapi_config`／分應用列表／split tunnel 讀寫／`sync_system_bars`／`deliver_account_callback` 經 tauri IPC 實調 | 模擬器 logcat + UI 走查（**殼層重驗，進行中**） |
| MOB-19 | UI 資產走 tauri 協議：打包 app 從 `http://tauri.localhost` 載入共享 UI，數據面連進程內 LocalAPI，Connect/Disconnect 全循環 | 模擬器 screencap + logcat（**殼層重驗，進行中**） |
| MOB-20 | 深鏈：`adb` 注入 `xbond://install-config` 與 `xbond://callback`，事件路由到導入表單與 `/account/callback` 投遞 | adb + logcat（**殼層重驗，待做**） |
| MOB-21 | `tauri android dev` 迴圈：HMR 直達 WebView、Ctrl-C 清理 reverse | `pnpm mobile:dev`（**待驗**） |

## 已知限制

真機項待驗：休眠／切網重連、Always-On、電池、按應用分流實測。gen 再生成覆蓋手改（清單見上）。`check_for_updates` 的安裝流（未知來源授權回續）在插件態未上機複驗。iOS 殼層（`tauri-plugin-xbond` Swift 包 + gen/apple + PacketTunnel 擴展）屬同一切片，狀態記錄在任務記錄。
