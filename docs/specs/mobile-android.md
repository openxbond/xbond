# Android VPN 層

**狀態**：契約已確認；fd 交接、生命週期與分流的平台側代碼已交付（`apps/mobile/android/app/src/main/kotlin/net/xbond/app/XBondVpnService.kt`、`apps/mobile/android/AndroidManifest.xml`、Go 側 `mobile/service.go`）。已交付 gradle app 工程（包名 `net.xbond.app`）並在**模擬器上端到端驗收**（Kotlin 編譯通過、APK 裝入 API 36 x86_64 模擬器實測，見 MOB-05）；真機驗收（休眠／切網重連、Always-On、電池、按應用分流實測）仍屬後續切片。

## 範圍與入口

本規格定義 Android 宿主的 VPN 接線契約（重梳方案 §五「移動端使用系統 VPN」）。宿主工程為 gradle app 模塊（`apps/mobile/android/app/`，`assembleDebug` 產出 APK；依賴 `pnpm mobile:bind:android` 產出的 AAR 置於 `app/libs/`），包名 `net.xbond.app`；`MainActivity` 是最小控制面（配置文本域＋連接／斷開＋狀態輪詢，支持 `configB64`／`probeUrl` 冒煙 extra），完整 React 畫面是後續切片。平台側（Kotlin）擁有權限申請、TUN 構建（地址／路由／分流）、前台通知與 `protect()`；Go 側（gomobile `mobile.TunnelService`）擁有核心生命週期、按訂閱格式的雙核心選擇與派生（`engine.DeriveMobileRuntimeConfig`）。AAR 由 `pnpm mobile:bind:android` 產出（`xbond-mobile.aar`，全 Android 架構）。

## 行為契約

### fd 交接與生命週期

1. **prepare**：UI Activity 啟動前經 `XBondVpnService.prepare(context)` 取得授權意圖（非空 = 先請求權限）；服務不自行繞過。
2. **啟動**：`ACTION_START`（攜帶配置與可選分流清單）→ 構建 TUN（`172.19.0.1/30`、DNS `172.19.0.2`、默認路由、MTU 1500）→ `establish()` → 以 `XBOND_AUTOSTART` 語義等價的前台通知常駐（`systemExempted` 類型）→ **把 fd 交給 `TunnelService.Start(config, fd)`**——fd 只在 Stop 時返還；核心讀寫該 fd，平台不得先行關閉。
3. **粘性恢復**：`START_STICKY`；進程被殺後系統以空 intent 重啟時，用保存的配置重建隧道。`onRevoke`（用戶撤權或他方 VPN 接管）清空保存配置並完整拆除，粘性重啟不得無權復活。
4. **停止**：先 `TunnelService.Stop()`（核心先停，避免讀已關閉的 fd），再關閉接口、移除通知、退出前台。

### 分流與重載

- 按應用分流是**平台側職責**：`EXTRA_ALLOWED` 非空時僅允許清單內應用（addAllowedApplication），否則 `EXTRA_DISALLOWED` 排除清單（addDisallowedApplication）。
- 訂閱更新不斷隧道：`TunnelService.Reload(config)` 只重啟核心（fd 保持有效，TunnelService 持有 `activeTunFd`），重載失敗由 manager 整體回滾到上一份有效配置；重載後 clash 客戶端跟隨新控制器端點。

### 構建與依賴（vendored 補丁）

`third_party/sing-box/` 是 **sing-box v1.13.21 原始模塊的完整副本**（MIT 許可與版權聲明保留於其 LICENSE；testdata 等構建無關內容已剪除），僅 `transport/v2rayhttp/force_close.go` 一個文件被補丁：上游 `go:linkname` 直指 x/net/http2 的 `connPool` **字段符號**，而依賴圖（mihomo 等）強制 x/net ≥ v0.61 後該符號在 c-shared/PIC 的 android arm／x86_64 鏈接中不再發出——gomobile bind 以 relocation 錯誤失敗（arm64 侥幸保留符號）。補丁以 `reflect` 讀同一字段，行為等價；字段缺失時返回原 transport 而非 panic。`go.mod` 以 `replace github.com/sagernet/sing-box => ./third_party/sing-box` 指向該副本，gomobile 會把本地目錄 replace 傳播進 work module（x/mobile bind.go 的既有行為），因此桌面、daemon 與移動端全部構建一致使用補丁副本；升級 sing-box 版本時需重新 vendor 並重放該補丁。除此之外全部依賴取最新穩定版（x/mobile@latest、x/net v0.61 等）。

## 驗收條件

| 編號 | 結果 | 驗證入口 |
| --- | --- | --- |
| MOB-01 | fd 只在 Stop 返還；Reload 不觸碰 fd、失敗回滾、clash 客戶端跟隨新端點 | `mobile/mobile_test.go`、`mobile/service.go` |
| MOB-02 | AAR 全 Android 架構（arm／arm64／x86／x86_64）構建成功，含補丁副本 | `pnpm mobile:bind:android`（實測 232 MB） |
| MOB-03 | Kotlin 服務實現 prepare／fd 交接／前台通知／分流／粘性恢復／onRevoke 拆除，**隨 APK 編譯** | gradle `assembleDebug`（實測通過） |
| MOB-04 | 全部依賴最新穩定版；sing-box 釘 v1.13.21（vendored 補丁副本） | `go.mod` |
| MOB-05 | **模擬器端到端**（API 36 x86_64）：安裝→appops 授權→`am start` 注入配置→fd 交接→tun0 UP→**系統連通性探測經隧道 204 成功（網絡 IS_VALIDATED）**→Chrome 經隧道開頁無錯→UI 斷開→tun0 銷毀、狀態歸零 | adb + logcat + dumpsys connectivity（2026-11-01 實測） |
| MOB-06 | 移動派生含 `dns-hijack any:53`（無此項系統 DNS 落入隧道無人應答，全部解析失敗——實測發現並修復）；移動模式 manager 就緒探針跳過 mixed 監聽（mixed-port 0 覆蓋構造默認值） | `internal/engine/derive.go`、`manager.go`；`engine_test.go` TestManagerMobileStartSkipsListenerProbe |

## 已知限制

真機項待驗：休眠／切網重連、Always-On、電池、按應用分流實測。**應用自身流量語義**：模擬器實測顯示 VPN 擁有者應用自身的探針 DNS 解析立即失敗（uid 捕獲範圍與系統自排除語義交錯），而系統與被捕獲應用（Chrome）流量全程正常——應用內探測應走 controller 而非自身 socket，後續 UI 切片遵循。sing-box 移動派生未注入 DNS 塊（clash 路徑已驗證，sing-box 訂閱在移動端解析需後續補）。`x/mobile` 無版本標籤（@latest 偽版本）。vendored 副本的單文件補丁在升級 sing-box 或 x/net 時需重驗；若上游改用非 linkname 方案可移除補丁恢復原生模塊。iOS PacketTunnel 側未在本規格範圍。
