# Android VPN 層

**狀態**：契約已確認；fd 交接、生命週期與分流的平台側代碼已交付（`apps/mobile/android/app/src/main/kotlin/net/xbond/app/XBondVpnService.kt`、`apps/mobile/android/AndroidManifest.xml`、Go 側 `mobile/service.go`）。已交付 gradle app 工程（包名 `net.xbond.app`）並在**模擬器上端到端驗收**（Kotlin 編譯通過、APK 裝入 API 36 x86_64 模擬器實測，見 MOB-05）；**雙核心均通過模擬器端到端**（clash 先行，sing-box 隨後補齊，見 MOB-07）；**共享 React UI 已上機**（WebView 宿主 + 進程內 LocalAPI，UI 驅動連接／斷開全循環，見 MOB-10）。2026-11-09 切片補齊：移動 LocalAPI 路由與分流層達到守護進程同契約（Go 測試通過，MOB-11）、分應用代理 UI→SharedPreferences→讀回全鏈上機驗證（MOB-12 部分）、4-Tab 移動界面／系統欄同步／返回手勢上機驗證（MOB-13 部分）；**運行中隧道重建需接入訂閱後複驗，`pnpm mobile:dev` 熱重載循環待驗**；真機驗收（休眠／切網重連、Always-On、電池、按應用分流實測）仍屬後續切片。

## 範圍與入口

本規格定義 Android 宿主的 VPN 接線契約（重梳方案 §五「移動端使用系統 VPN」）。宿主工程為 gradle app 模塊（`apps/mobile/android/app/`，`assembleDebug` 產出 APK；依賴 `pnpm mobile:bind:android` 產出的 AAR），包名 `net.xbond.app`；`MainActivity` 以 WebView 宿主共享 React UI，並附平台面：`window.XBondAndroid` JS 橋（分應用代理讀寫、手動檢查更新、系統欄隨主題同步）、系統返回手勢（先關 Radix 浮層、再退回首頁、最後退到後台）、`onShowFileChooser` 本地配置選擇、`dev_url` extra 直連 Vite 開發服務器。平台側（Kotlin）擁有權限申請、TUN 構建（地址／路由／分應用分流）、前台通知與 `protect()`；Go 側（gomobile `mobile.TunnelService`）擁有核心生命週期、按訂閱格式的雙核心選擇與派生（`engine.DeriveMobileRuntimeConfig`）。AAR 由 `pnpm mobile:bind:android` 產出（`xbond-mobile.aar`，全 Android 架構）。

## 行為契約

### fd 交接與生命週期

1. **prepare**：UI Activity 啟動前經 `XBondVpnService.prepare(context)` 取得授權意圖（非空 = 先請求權限）；服務不自行繞過。
2. **啟動**：`ACTION_START`（攜帶配置與可選分流清單）→ 構建 TUN（`172.19.0.1/30`、DNS `172.19.0.2`、默認路由、MTU 1500）→ `establish()` → 以 `XBOND_AUTOSTART` 語義等價的前台通知常駐（`systemExempted` 類型）→ **把 fd 交給 `TunnelService.Start(config, fd)`**——fd 只在 Stop 時返還；核心讀寫該 fd，平台不得先行關閉。
3. **粘性恢復**：`START_STICKY`；進程被殺後系統以空 intent 重啟時，用保存的配置重建隧道。`onRevoke`（用戶撤權或他方 VPN 接管）清空保存配置並完整拆除，粘性重啟不得無權復活。
4. **停止**：先 `TunnelService.Stop()`（核心先停，避免讀已關閉的 fd），再關閉接口、移除通知、退出前台。

### 進程內 LocalAPI 與移動運行時

應用進程內嵌一份守護進程同契約的 LocalAPI（`mobile/server.go`，僅回環、token 鑑權，token 同步落 `localapi.token`、端口落 `localapi.addr`）：共享 Web UI 與 LocalAPI 工具以同一組 `/localapi/v0/*` 端點驅動移動宿主。`up` 經 PlatformBridge 的 `requestConnect` 同步建立 VPN（需要同意時拋錯、LocalAPI 答 409），`down` 經 `requestDisconnect` 完整拆除。sing-box 移動派生顯式禁用 cache_file。

路由契約與守護進程對齊：profiles（GET/POST，URL／內聯導入與可選立即激活）、單訂閱 override、全局 mixin、source 讀寫與 pin、versions/rollback、subs/url、subs/unpin、subs PATCH 的 `updateIntervalHours`、rules/page（分頁搜索，status 帶 `rulePaging: true`）、connections DELETE（`?id=all` 或指定 id）與 `POST /account/callback`（深鏈回調著陸）全部可用；auth 中間件帶與守護進程一致的 CORS（`pnpm mobile:dev` 的 Vite 頁面跨域直連模擬器內 LocalAPI）。

**OAuth scheme 登錄**（2026-11-09 補齊，與桌面同契約）：登入請求帶 `callbackScheme: "xbond"`（移動宿主由前端注入），瀏覽器完成授權後 302 到 `xbond://callback?code&state`，OS 深鏈跳回 App；`MainActivity`（onCreate 冷啟動與 onNewIntent 熱路徑都覆蓋）解析 code/state 直接 POST 到 LocalAPI `/account/callback`（短重試 8×500ms，覆蓋 LocalAPI 未就緒窗口），賬戶控制器校驗 state 後完成換票——深鏈 query 是憑據，日誌只記 scheme/host。登入綁定後立即拉取訂閱內容（`runtime.update`，與桌面 `bindCredentials` 一致）：「登入成功」即「配置可用」，不留「有訂閱無配置」的半態。

移動運行時（`mobile/runtime.go`）在派生前合併分流層：源 → 單訂閱 override → 全局 mixin（`engine.ApplyLayers`，與守護進程同序），衝突在觸碰核心前失敗。override、mixin、源編輯與回滾在隧道運行時經 `reapplyIfRunning` 熱重載——平臺 fd 保持有效，系統 VPN 圖標不閃爍。

### WebView UI 宿主

共享 Web UI 以 gradle `copyWebDist` 打進 APK assets，`MainActivity` 啟動時提取到數據目錄（先於服務啟動——LocalAPI 按請求讀取 index，`/` 路由無條件註冊以消解提取／啟動競態），隨後以 `ENSURE` 動作拉起服務（只創建 TunnelService 與 LocalAPI、不觸碰隧道），輪詢 `localapi.addr` 後在 WebView 內加載 `http://127.0.0.1:<port>/`。陳舊端口文件在拉起前刪除，避免加載上一進程的死端口。WebView 走 `network_security_config` 放行的回環明文白名單。VPN 同意在 Activity 首次啟動時預授權（服務上下文無法彈系統對話框；被拒的同意之後以 `/up` 的 409 浮現，交互重試屬後續 UI 切片）。`/down` 只拆隧道資源不 `stopSelf`——UI 存續期間 LocalAPI 保持可用；`ACTION_STOP` 與 `onRevoke` 仍完整收縮。

### 分流與重載

- **分應用代理**是平台側職責，持久化在 `SplitTunnelPrefs`（SharedPreferences `xbond_vpn_prefs`）：`mode` = `all`（默認，全局代理）| `disallow`（黑名單）| `allow`（白名單），`packages` 為選中包名集合。`buildVpnInterface` 在 Intent 未攜帶顯式覆蓋陣列時讀取該配置：allow 模式逐包 `addAllowedApplication`；單包 add 失敗不拖垮整個 `establish()`。**應用自身在所有模式下恆被 `addDisallowedApplication` 排除**——核心出站撥號、更新下載、雲同步必須走物理網，否則回環進自己的隧道（自 DNS 遞歸、出站全死）。`listInstalledAppsJSON` 供 UI 選擇器：排除自身與無 INTERNET 權限包，按名稱排序並標記系統應用。
- **TUN 采纳链（2026-11-09 走查實測）**：fd 模式下核心要真正接管流量，四個前提缺一不可——
  1. `auto-route=false` 且 `auto-detect-interface=false`：mihomo 只要兩者之一開啟就創建 sing-tun NetworkUpdateMonitor，而 Android untrusted_app 的 netlink socket 被 SELinux 禁止，monitor 創建失敗會**硬失敗整個 TUN listener**（核心靜默降級 mixed-only，UI 仍顯示已連接）。
  2. **TUN 網段地址必須掛在接口上**：mihomo 把 TUN 內 DNS 服務器綁在 fake-ip 段首地址（198.18.0.1）與其 IPv6 對應（fdfe:dcba:9876::1）——builder 需 `addAddress` 這兩個段（另有 172.19.0.1/30 給 sing-box 派生），否則 `bind: cannot assign requested address`。
  3. **`stack: gvisor`**：mixed 棧的 system 路徑在 Android fd 采納隧道上丟 TCP（內核計數顯示包到達、gvisor ICMP fake-echo 正常，但 TCP 握手永不完成）；官方 CMFA 同樣默認 gvisor。
  4. **DNS 引導解析**：`ensureDNSForTun` 必須提供純 IP UDP `default-nameserver`（223.5.5.5 / 8.8.8.8），且 nameserver 不用 "system"（Android 無 /etc/resolv.conf）——否則加密上游（DoH 域名）的首次解析無處問詢，所有出站 dial 死於 "dns resolve failed" 死鎖。以上任一不成立都是**靜默假成功**：`/configs` 的 `tun.enable=false` 是判定真相的地方（UI 狀態與系統 VPN 圖標都不算數）。
- **運行中換配置**：`XBondVpnService.reloadIfConnected()`（JS 橋保存後觸發）先建新接口，成功後停核心、換接口、走 `/up` 同一 runtime apply 路徑重啟核心——舊隧道在建立失敗時原樣保留，系統 VPN 圖標全程不消失。隧道未建立時僅保存配置，下次連接生效。
- **核心 controller 端點進程內固定**（`mobileRuntime.baseEndpoint`）：apply/reload 復用同一 port+secret。頁面 meta（PWA service worker 會緩存 index、繞過 meta 注入）與 status preferences 兩條路徑拿到的端點都必須穩定——每 apply 重隨機會把 UI 擱淺在死端點上（代理頁「Authentication failed」）。stable 前端另由 controllerProxy 承擔（WebSocket 流跨重載不斷）。
- 訂閱更新不斷隧道：`TunnelService.Reload(config)` 只重啟核心（fd 保持有效，TunnelService 持有 `activeTunFd`），重載失敗由 manager 整體回滾到上一份有效配置；重載後 clash 客戶端跟隨新控制器端點。

### 開發與運行命令

- `pnpm mobile:dev`：無在線設備時自動拉起第一個 AVD（優先 `Medium_Phone_API_37.0`）並等待開機；AAR／web dist 缺失時自動補建；gradle `installDebug` 裝 APK；在 127.0.0.1:1421 起開 Vite（根配置 dev server）並 `adb reverse tcp:1421`，以 `--es dev_url` 拉起 App——WebView 直連 Vite HMR 頁面，經 bootstrap 參數 `?localapi_addr&localapi_token` 接進模擬器內真實 LocalAPI 與 `window.XBondAndroid`。Ctrl-C 清理 reverse。`--rebuild` 強制重裝 APK。
- `pnpm mobile:android`：`pnpm build` 產出 web dist → gradle `installDebug` 重裝 → 以打包形態拉起（無 dev_url），驗證最終獨立發版包體驗。gradle 二進制取 PATH 或 `~/.gradle/wrapper/dists` 最新發行版；SDK 按環境變量與常見位置探測後注入 `ANDROID_HOME`。

### 構建與依賴（原生模塊接入）

**mihomo v1.19.33** 與 **sing-box v1.13.21** 均直接引用上游模塊（無 `third_party/` vendored 副本，無 `go.mod` `replace`）：

- **mihomo Android 嵌入（`cmfa` build tag）**：`scripts/mobile.ts` 在 Android bind 時傳入 `MOBILE_ANDROID_TAGS`（`with_gvisor,with_quic,with_utls,with_clash_api,cmfa`），啟用上游內建的 Android VPN 宿主嵌入模式——跳過 `sing-tun` PackageManager 直讀 `/data/system/packages.xml`（untrusted_app 被 SELinux 拒絕），分應用由平台 `VpnService`（`addAllowed/DisallowedApplication`）承擔；同時關閉 netlink 回環檢測與 `/etc/resolv.conf` 讀取。
- **sing-box 移動端接入（`adapter.PlatformInterface`）**：`NewBoxContext()` 在移動平台或註冊了移動 TUN fd 時注入 `mobilePlatformInterface`（`internal/engine/tun_fd.go`）——經 `OpenInterface` 注入平台 VPN fd，經 `CreateDefaultInterfaceMonitor` 提供非 nil 空監視器避免創建被 SELinux 禁止的 netlink socket 與直讀 `packages.xml`；日誌經 `instance.LogFactory().(log.ObservableFactory)` 訂閱而非 `box.Options.PlatformLogWriter`，使 `cache_file.enabled=false` 原生生效；`x/net >= v0.61` 下被內聯死碼消除的 `http2.(*Transport).connPool` 符號在 `internal/engine/tun_fd.go` 由 `go:linkname` 提供，消除 `gomobile bind` 的重定位錯誤。

## 驗收條件

| 編號 | 結果 | 驗證入口 |
| --- | --- | --- |
| MOB-01 | fd 只在 Stop 返還；Reload 不觸碰 fd、失敗回滾、clash 客戶端跟隨新端點 | `mobile/mobile_test.go`、`mobile/service.go` |
| MOB-02 | AAR 全 Android 架構（arm／arm64／x86／x86_64）構建成功 | `pnpm mobile:bind:android`（實測 232 MB） |
| MOB-03 | Kotlin 服務實現 prepare／fd 交接／前台通知／分流／粘性恢復／onRevoke 拆除，**隨 APK 編譯** | gradle `assembleDebug`（實測通過） |
| MOB-04 | 全部依賴最新穩定版；sing-box 釘 v1.13.21、mihomo 釘 v1.19.33（均為原生模塊） | `go.mod` |
| MOB-05 | **模擬器端到端**（API 36 x86_64）：安裝→appops 授權→`am start` 注入配置→fd 交接→tun0 UP→**系統連通性探測經隧道 204 成功（網絡 IS_VALIDATED）**→Chrome 經隧道開頁無錯→UI 斷開→tun0 銷毀、狀態歸零 | adb + logcat + dumpsys connectivity（2026-11-01 實測） |
| MOB-06 | 移動派生含 `dns-hijack any:53`（無此項系統 DNS 落入隧道無人應答，全部解析失敗——實測發現並修復）；移動模式 manager 就緒探針跳過 mixed 監聽（mixed-port 0 覆蓋構造默認值） | `internal/engine/derive.go`、`manager.go`；`engine_test.go` TestManagerMobileStartSkipsListenerProbe |
| MOB-07 | **sing-box 移動端到端**（同一模擬器）：fd 經 `adapter.PlatformInterface.OpenInterface` 注入（JSON 不再攜帶 `file_descriptor`）→ `address` 鏡像 VPN builder → cache-file 落數據目錄 → DNS 塊與 sniff/hijack-dns 規則注入 → direct 出站啟動 → tun0 UP → **系統連通性校驗經隧道通過（WIFI\|VPN validation passed）**→ 停止銷毀 tun0、無 fdsan 雙關閉 | adb + logcat + dumpsys（2026-11-01 實測）；`engine_test.go` TestDeriveSingBoxTunDNSInjection、TestMobileTunFDHook |
| MOB-09 | 進程內 LocalAPI 全鏈路（模擬器 adb forward 實測）：`/login`（content 導入→Use）→ `/restart`（運行時 apply 重載）→ `/nodes`/`/mode`（routing 切換重載）→ `/logs`（ring 經 observable 收 sing-box 日誌）→ `/rules`/`/connections`（controller 直讀）→ `/down`（tun0 銷毀、零 fdsan abort）；期間 **WIFI\|VPN 系統校驗經隧道通過** | adb forward + curl（2026-11-01 實測） |
| MOB-10 | **共享 React UI 上機全循環**（模擬器實測）：WebView 渲染移動四標籤佈局（三層狀態卡／策略組／接管選擇器）→ UI 點 Connect → fd 交接、tun0 UP、UI 翻轉 Proxy running＋三層綠點 → UI 點 Disconnect → tun0 銷毀、回到 Not connected；服務全程保活（LocalAPI 不隨斷開消失）、零 fdsan abort | adb + screencap + input tap（2026-11-01 實測） |
| MOB-08 | fd 所有權二分：Kotlin 以 dup 移交核心（sing-tun 關閉其所採納的 dup），原件保留在平台側、關閉即銷毀接口——任何一側都不再雙關閉同一 fd；核心 panic 在 Go/Java 邊界轉為錯誤並落棧到 `go-panic.log`（fd 2 重定向），不再殺死進程 | `XBondVpnService.kt`（dup+detach）、`mobile/service.go` guardCorePanic、`paniclog_linux.go` |
| MOB-11 | 移動 LocalAPI 與守護進程同契約：CORS 預檢無 token 放行、無 token 401；profiles 導入即列表；override/mixin 讀寫回環；rules/page 與 connections DELETE 在核心停止時誠實 503；runtime apply 烘焙 override+mixin 層（規則與 LAN bypass 進源） | `mobile/server_test.go`、`go test -tags mobile ./mobile/`（2026-11-09 通過） |
| MOB-12 | 分應用代理：UI 勾選 → JS 橋持久化（SharedPreferences `mode`+`packages`）→ 配置行摘要讀回——**已上機驗證**（模擬器實測：應用列表經 QUERY_ALL_PACKAGES 載入、勾選+切 disallow 落盤 `mode=disallow`、行摘要「1 app(s) bypass the VPN」）；運行中 `reloadIfConnected` 隧道重建（黑/白名單對 app 流量生效）需接入訂閱連接後複驗 | adb + run-as shared_prefs（2026-11-09 實測）；隧道重建待驗 |
| MOB-13 | 4-Tab 移動界面：單層頂欄（無原生灰條/雙頂欄）、Hero 大開關、配置 Tab 分組列表、Per-app Sheet、深淺色系統欄同步、返回手勢（首頁退後台、進程保活）——**已上機驗證**（模擬器實測）；`pnpm mobile:dev` 熱重載循環待驗 | adb + screencap（2026-11-09 實測）；HMR 循環待驗 |
| MOB-14 | OAuth scheme 登錄管道：冷啟動與熱路徑（onNewIntent）深鏈均到達 `handleDeepLink`，Activity 解析 code/state 後 POST `/account/callback`，偽 state 被 LocalAPI 如實 400 拒絕（重試 8 次後止），OS 深鏈能把 App 拉回前台；Go 層 state 匹配（forged→400、matching→200）單測通過。**真實瀏覽器 OAuth 跳回與登入後自動拉取訂閱待用戶賬號實測** | `mobile/server_test.go` TestAPIAccountCallbackScheme、adb 深鏈 + logcat（2026-11-09 實測）；真實登錄待驗 |
| MOB-15 | **TUN 端到端假成功排查與修復**（2026-11-09 模擬器實測）：四層根因逐層剝離——① monitor netlink 禁（`auto-detect-interface:false`）② packages.xml 讀拒（`cmfa` build tag 啟用嵌入模式）③ TUN 網段地址未掛接口（builder 加 198.18.0.1/30 + fdfe::1/126）④ mixed 棧 fd 模式丟 TCP（`stack: gvisor`）+ DNS 引導死鎖（`default-nameserver` 純 IP）+ 自環（本 app 恆排除）。修復後：`/configs` `tun.enable=true`、fake-ip DNS hijack 應答（ping example.com → 198.18.0.5）、真實 TCP 經節點轉發（`/connections` 出現 mtalk.google.com → 菲律賓節點、down/up 計數增長） | `/configs` + logcat GoLog + `/proc/net/dev` 計數 + LocalAPI connections（2026-11-09 實測） |

## 已知限制

真機項待驗：休眠／切網重連、Always-On、電池、按應用分流實測。**WebView 宿主**：UI 資產隨 APK 分發，`sw.js` 的 PWA 緩存在 WebView 內可能滯後一個版本（資產按版本提取可兜底，尚未做哈希校驗）；控制器 WebSocket 的實時頁面（日誌流）未在本切片驗證。**應用自身流量語義**：模擬器實測顯示 VPN 擁有者應用自身的探針 DNS 解析立即失敗（uid 捕獲範圍與系統自排除語義交錯），而系統與被捕獲應用（Chrome）流量全程正常——應用內探測應走 controller 而非自身 socket，後續 UI 切片遵循。`x/mobile` 無版本標籤（@latest 偽版本）。iOS PacketTunnel 側未在本規格範圍。
