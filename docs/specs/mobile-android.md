# Android VPN 層

**狀態**：契約已確認；fd 交接、生命週期與分流的平台側代碼已交付（`apps/mobile/android/app/src/main/kotlin/net/xbond/app/XBondVpnService.kt`、`apps/mobile/android/AndroidManifest.xml`、Go 側 `mobile/service.go`）。已交付 gradle app 工程（包名 `net.xbond.app`）並在**模擬器上端到端驗收**（Kotlin 編譯通過、APK 裝入 API 36 x86_64 模擬器實測，見 MOB-05）；**雙核心均通過模擬器端到端**（clash 先行，sing-box 隨後補齊，見 MOB-07）；**共享 React UI 已上機**（WebView 宿主 + 進程內 LocalAPI，UI 驅動連接／斷開全循環，見 MOB-10）；真機驗收（休眠／切網重連、Always-On、電池、按應用分流實測）仍屬後續切片。

## 範圍與入口

本規格定義 Android 宿主的 VPN 接線契約（重梳方案 §五「移動端使用系統 VPN」）。宿主工程為 gradle app 模塊（`apps/mobile/android/app/`，`assembleDebug` 產出 APK；依賴 `pnpm mobile:bind:android` 產出的 AAR 置於 `app/libs/`），包名 `net.xbond.app`；`MainActivity` 是最小控制面（配置文本域＋連接／斷開＋狀態輪詢，支持 `configB64`／`probeUrl` 冒煙 extra），完整 React 畫面是後續切片。平台側（Kotlin）擁有權限申請、TUN 構建（地址／路由／分流）、前台通知與 `protect()`；Go 側（gomobile `mobile.TunnelService`）擁有核心生命週期、按訂閱格式的雙核心選擇與派生（`engine.DeriveMobileRuntimeConfig`）。AAR 由 `pnpm mobile:bind:android` 產出（`xbond-mobile.aar`，全 Android 架構）。

## 行為契約

### fd 交接與生命週期

1. **prepare**：UI Activity 啟動前經 `XBondVpnService.prepare(context)` 取得授權意圖（非空 = 先請求權限）；服務不自行繞過。
2. **啟動**：`ACTION_START`（攜帶配置與可選分流清單）→ 構建 TUN（`172.19.0.1/30`、DNS `172.19.0.2`、默認路由、MTU 1500）→ `establish()` → 以 `XBOND_AUTOSTART` 語義等價的前台通知常駐（`systemExempted` 類型）→ **把 fd 交給 `TunnelService.Start(config, fd)`**——fd 只在 Stop 時返還；核心讀寫該 fd，平台不得先行關閉。
3. **粘性恢復**：`START_STICKY`；進程被殺後系統以空 intent 重啟時，用保存的配置重建隧道。`onRevoke`（用戶撤權或他方 VPN 接管）清空保存配置並完整拆除，粘性重啟不得無權復活。
4. **停止**：先 `TunnelService.Stop()`（核心先停，避免讀已關閉的 fd），再關閉接口、移除通知、退出前台。

### 進程內 LocalAPI 與移動運行時

應用進程內嵌一份守護進程同契約的 LocalAPI（`mobile/server.go`，僅回環、token 鑑權，token 同步落 `localapi.token`、端口落 `localapi.addr`）：共享 Web UI 與 LocalAPI 工具以同一組 `/localapi/v0/*` 端點驅動移動宿主。移動運行時（`mobile/runtime.go`）是守護進程運行時的 VPN 形態孿生——活動訂閱為唯一配置源、平台 TUN fd 為唯一接管、路由模式為唯一偏好；`up` 經 PlatformBridge 新增的 `requestConnect` 同步建立 VPN（需要同意時拋錯、LocalAPI 答 409，交互流程屬 UI 切片），`down` 經 `requestDisconnect` 完整拆除。賬戶端點以 501 明確不可用（雲登錄屬後續切片）。sing-box 移動派生顯式禁用 cache_file（依賴 box.go 補丁④）。

### WebView UI 宿主

共享 Web UI 以 gradle `copyWebDist` 打進 APK assets，`MainActivity` 啟動時提取到數據目錄（先於服務啟動——LocalAPI 按請求讀取 index，`/` 路由無條件註冊以消解提取／啟動競態），隨後以 `ENSURE` 動作拉起服務（只創建 TunnelService 與 LocalAPI、不觸碰隧道），輪詢 `localapi.addr` 後在 WebView 內加載 `http://127.0.0.1:<port>/`。陳舊端口文件在拉起前刪除，避免加載上一進程的死端口。WebView 走 `network_security_config` 放行的回環明文白名單。VPN 同意在 Activity 首次啟動時預授權（服務上下文無法彈系統對話框；被拒的同意之後以 `/up` 的 409 浮現，交互重試屬後續 UI 切片）。`/down` 只拆隧道資源不 `stopSelf`——UI 存續期間 LocalAPI 保持可用；`ACTION_STOP` 與 `onRevoke` 仍完整收縮。

### 分流與重載

- 按應用分流是**平台側職責**：`EXTRA_ALLOWED` 非空時僅允許清單內應用（addAllowedApplication），否則 `EXTRA_DISALLOWED` 排除清單（addDisallowedApplication）。
- 訂閱更新不斷隧道：`TunnelService.Reload(config)` 只重啟核心（fd 保持有效，TunnelService 持有 `activeTunFd`），重載失敗由 manager 整體回滾到上一份有效配置；重載後 clash 客戶端跟隨新控制器端點。

### 構建與依賴（vendored 補丁）

`third_party/sing-box/` 是 **sing-box v1.13.21 原始模塊的完整副本**（MIT 許可與版權聲明保留於其 LICENSE；testdata 等構建無關內容已剪除），三處文件被補丁（文檔副本見 `scripts/patches/`）：① `transport/v2rayhttp/force_close.go`——上游 `go:linkname` 直指 x/net/http2 的 `connPool` **字段符號**，而依賴圖（mihomo 等）強制 x/net ≥ v0.61 後該符號在 c-shared/PIC 的 android arm／x86_64 鏈接中不再發出，gomobile bind 以 relocation 錯誤失敗（arm64 侥幸保留符號）；補丁以 `reflect` 讀同一字段，行為等價，字段缺失時返回原 transport 而非 panic。② `protocol/tun/hook.go`（含 `inbound.go` 調用點一行）——`HookBeforeCreatePlatformInterface` 增帶 `*tun.Options` 參數：v1.13 已從 JSON 移除 `file_descriptor`（嚴格解析直接拒絕），fd 的唯一運行時入口是 sing-tun 的 `tun.Options.FileDescriptor`，而替代通道 libbox 平台接口的存在本身會翻轉 `ForwarderBindInterface` 並跳過 `BuildAndroidRules`，副作用嵌入式 fd 模式不能接受；xbond 側 `engine.SetMobileTunFD` 經此 hook 在設備打開前注入 fd。③ `protocol/direct/outbound.go` 的 `fetchMyAddresses`——上游不判空 `InterfaceMonitor()`，而 Android 普通應用（untrusted_app）被 SELinux 禁止 netlink socket，監視器合法地為 nil，direct 出站一啟動即 SIGSEGV（`addr=0x30`，PostStart 階段）；補丁加 nil 守衛提前返回。④ `box.go` 的 `needCacheFile`——上游在存在 PlatformLogWriter 時無視配置強制開啟 cachefile，而其 bbolt close 在 Android 上以 `funlock EBADF` 失敗、殺死每一次核心重載；補丁讓顯式 `cache_file.enabled=false` 勝過 writer（僅 writer、無顯式配置時維持上游默認）。①③④均值得上游報告；截至 v1.13.21 無修復。`go.mod` 以 `replace github.com/sagernet/sing-box => ./third_party/sing-box` 指向該副本，gomobile 會把本地目錄 replace 傳播進 work module（x/mobile bind.go 的既有行為），因此桌面、daemon 與移動端全部構建一致使用補丁副本；升級 sing-box 版本時需重新 vendor 並重放該補丁。除此之外全部依賴取最新穩定版（x/mobile@latest、x/net v0.61 等）。

## 驗收條件

| 編號 | 結果 | 驗證入口 |
| --- | --- | --- |
| MOB-01 | fd 只在 Stop 返還；Reload 不觸碰 fd、失敗回滾、clash 客戶端跟隨新端點 | `mobile/mobile_test.go`、`mobile/service.go` |
| MOB-02 | AAR 全 Android 架構（arm／arm64／x86／x86_64）構建成功，含補丁副本 | `pnpm mobile:bind:android`（實測 232 MB） |
| MOB-03 | Kotlin 服務實現 prepare／fd 交接／前台通知／分流／粘性恢復／onRevoke 拆除，**隨 APK 編譯** | gradle `assembleDebug`（實測通過） |
| MOB-04 | 全部依賴最新穩定版；sing-box 釘 v1.13.21（vendored 補丁副本） | `go.mod` |
| MOB-05 | **模擬器端到端**（API 36 x86_64）：安裝→appops 授權→`am start` 注入配置→fd 交接→tun0 UP→**系統連通性探測經隧道 204 成功（網絡 IS_VALIDATED）**→Chrome 經隧道開頁無錯→UI 斷開→tun0 銷毀、狀態歸零 | adb + logcat + dumpsys connectivity（2026-11-01 實測） |
| MOB-06 | 移動派生含 `dns-hijack any:53`（無此項系統 DNS 落入隧道無人應答，全部解析失敗——實測發現並修復）；移動模式 manager 就緒探針跳過 mixed 監聽（mixed-port 0 覆蓋構造默認值） | `internal/engine/derive.go`、`manager.go`；`engine_test.go` TestManagerMobileStartSkipsListenerProbe |
| MOB-07 | **sing-box 移動端到端**（同一模擬器）：fd 經 vendored hook 注入（JSON 不再攜帶 `file_descriptor`）→ `address` 鏡像 VPN builder → cache-file 落數據目錄 → DNS 塊與 sniff/hijack-dns 規則注入 → direct 出站啟動（nil 監視器補丁）→ tun0 UP → **系統連通性校驗經隧道通過（WIFI\|VPN validation passed）**→ 停止銷毀 tun0、無 fdsan 雙關閉 | adb + logcat + dumpsys（2026-11-01 實測）；`engine_test.go` TestDeriveSingBoxTunDNSInjection、TestMobileTunFDHook |
| MOB-09 | 進程內 LocalAPI 全鏈路（模擬器 adb forward 實測）：`/login`（content 導入→Use）→ `/restart`（運行時 apply 重載）→ `/nodes`/`/mode`（routing 切換重載）→ `/logs`（ring 經 writer 收 sing-box 日誌）→ `/rules`/`/connections`（controller 直讀）→ `/down`（tun0 銷毀、零 fdsan abort）；期間 **WIFI\|VPN 系統校驗經隧道通過** | adb forward + curl（2026-11-01 實測） |
| MOB-10 | **共享 React UI 上機全循環**（模擬器實測）：WebView 渲染移動四標籤佈局（三層狀態卡／策略組／接管選擇器）→ UI 點 Connect → fd 交接、tun0 UP、UI 翻轉 Proxy running＋三層綠點 → UI 點 Disconnect → tun0 銷毀、回到 Not connected；服務全程保活（LocalAPI 不隨斷開消失）、零 fdsan abort | adb + screencap + input tap（2026-11-01 實測） |
| MOB-08 | fd 所有權二分：Kotlin 以 dup 移交核心（sing-tun 關閉其所採納的 dup），原件保留在平台側、關閉即銷毀接口——任何一側都不再雙關閉同一 fd；核心 panic 在 Go/Java 邊界轉為錯誤並落棧到 `go-panic.log`（fd 2 重定向），不再殺死進程 | `XBondVpnService.kt`（dup+detach）、`mobile/service.go` guardCorePanic、`paniclog_linux.go` |

## 已知限制

真機項待驗：休眠／切網重連、Always-On、電池、按應用分流實測。**WebView 宿主**：UI 資產隨 APK 分發，`sw.js` 的 PWA 緩存在 WebView 內可能滯後一個版本（資產按版本提取可兜底，尚未做哈希校驗）；控制器 WebSocket 的實時頁面（日誌流）未在本切片驗證。**應用自身流量語義**：模擬器實測顯示 VPN 擁有者應用自身的探針 DNS 解析立即失敗（uid 捕獲範圍與系統自排除語義交錯），而系統與被捕獲應用（Chrome）流量全程正常——應用內探測應走 controller 而非自身 socket，後續 UI 切片遵循。`x/mobile` 無版本標籤（@latest 偽版本）。vendored 副本的單文件補丁在升級 sing-box 或 x/net 時需重驗；若上游改用非 linkname 方案可移除補丁恢復原生模塊。iOS PacketTunnel 側未在本規格範圍。
