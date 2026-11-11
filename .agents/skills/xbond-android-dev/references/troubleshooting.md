# XBond Android 故障排查與常見問題手冊

本手冊總結了 XBond 在 Android / Waydroid 環境下開發、編譯與運行時常見的問題及解決方案。

---

## 1. 編譯與構建問題

### Gradle / Java 版本不匹配 (`jlink` 異常)

- **症狀**：`Execution failed for task ':app:compileDebugJavaWithJavac'` 或 `jlink ... error`。
- **原因**：系統默認指向了過高或實驗性的 JDK（如 JDK 27）。Android Gradle Plugin (AGP 8.x) 要求 JDK 17 或 JDK 21。
- **解決**：在開發者個人級配置 `~/.gradle/gradle.properties` 中指定 JDK 17/21（或設置環境變量 `JAVA_HOME`），切勿將本地絕對路徑寫入項目受控文件：
  ```properties
  # ~/.gradle/gradle.properties (用戶本機配置，不提交至版本庫)
  org.gradle.java.home=/path/to/jdk-21
  ```

### gomobile bind AAR 構建失敗

- **症狀**：`mobile:bind:android` 失敗，提示缺少環境變量或 build tags 錯誤。
- **解決**：統一使用倉庫腳本構建，不要手動拼參數：
  ```bash
  pnpm android:bind
  ```
  構建參數集中在 `scripts/dev/go.ts` 的 `MOBILE_ANDROID_TAGS`（包含 `with_gvisor,with_quic,with_utls,with_clash_api,cmfa`）。

---

## 2. 網絡與內核問題

### sing-box 報錯 `dial UDP connection: no available network interface`

- **症狀**：DNS 解析超時，日誌顯示 `router: process DNS packet: dial UDP connection: no available network interface`。
- **原因**：
  1. `tun_fd.go` 中的 `mobilePlatformInterface.UsePlatformNetworkInterfaces()` 返回了 `false`，導致 sing-box 內核的可用網卡清單為空。
  2. `mobilePlatformInterface.Initialize` 沒有調用 `nm.UpdateInterfaces()` 主動向 sing-box 注入網卡清單。
  3. `mobileInterfaceMonitor.Start()` 沒有調用註冊的更新回調，導致 sing-box 停留在網絡暫停（`NetworkPause`）狀態。
- **解決**：確保 `tun_fd.go` 實現了 `NetworkInterfaces()` 採集物理網卡、`Initialize` 調用 `UpdateInterfaces()`，且 `mobileInterfaceMonitor.Start()` 通知 `defaultInterface` 回調。

### mihomo 首次啟動超時 (`can't download MMDB: context deadline exceeded`)

- **症狀**：VPN 連接卡死 90 秒後報錯退出。
- **原因**：mihomo 缺少本地 GeoIP 文件時會嘗試從遠程下載，在未聯通代理時超時。
- **解決**：XBond Cloud 訂閱默認採用 `target=sing-box`，sing-box 使用內建規則集與 JSON 配置，不依賴外部 MMDB。

### TCP 連接超時但 UDP/DNS 正常

- **症狀**：DNS 能解析，但 `curl` 任何外網 HTTP/HTTPS 端口都超時。
- **原因**：移动端配置誤用了 `stack: "mixed"` 或 `stack: "system"`。Android 平台普通應用無 root/iptables 權限，依賴內核 TCP 重定向的 `system` 棧無效。
- **解決**：在 `internal/engine/derive.go` 的 `deriveSingBoxMobile` 中，TUN 入站配置必須設置為 `"stack": "gvisor"`，使用純用戶態 TCP/IP 協議棧。

---

## 3. 生命週期與進程問題

### 切換瀏覽器進行 Google OAuth 後回調失敗 / 報錯 401

- **症狀**：授權成功跳轉回 `xbond://callback`，但 LocalAPI 報錯或連接超時。
- **原因**：
  1. `MainActivity` 的 `launchMode` 不是 `singleTask`，導致瀏覽器 Intent 重新創建了重複的 Activity，無法複用已有會話。
  2. 沒有調用 `bindService` 綁定 `XBondVpnService`，Android 在 Activity 退到後台時因資源回收殺死了 Go 進程，重置了內存中的 OAuth 狀態。
- **解決**：
  - `AndroidManifest.xml` 中 `MainActivity` 設為 `launchMode="singleTask"`。
  - `MainActivity.kt` 在 `onCreate` 中使用 `bindService(vpnIntent, connection, BIND_AUTO_CREATE)` 建立強引用綁定。

### 瀏覽器提示需要 Google 登錄或安全驗證 (2FA / CAPTCHA)

- **症狀**：點擊「登錄 XBond Cloud」跳轉至系統瀏覽器後，頁面停留於 Google 登錄頁、密碼輸入或雙重認證。
- **原則**：此類交互式安全認證屬於外部邊界，不可由自動化腳本偽造或強行破解。若宿主環境未預登錄，應由開發者在瀏覽器中手動完成登錄並授權，授權成功跳轉回 `xbond://callback` 後，Agent 再繼續後續的開發與測試流程。

---

## 4. Waydroid 環境問題

### Waydroid 窗口過多或界面凍結

- **命令修復**：
  ```bash
  waydroid prop set persist.waydroid.multi_windows false
  waydroid prop set persist.waydroid.suspend false
  waydroid prop set persist.waydroid.width 1080
  waydroid prop set persist.waydroid.height 1920
  adb shell wm density 420
  ```
- **重啟服務**：
  ```bash
  waydroid session stop
  # 重新啟動
  waydroid show-full-ui &
  ```
