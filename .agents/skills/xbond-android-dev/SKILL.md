---
name: xbond-android-dev
description: >-
  Use this skill when developing, building, packaging, running, debugging, or verifying the XBond Android application, Waydroid emulator, or mobile VPN tunnel. Covers gomobile AAR builds, APK packaging, Chrome DevTools Protocol (CDP) WebView inspection, XBond Cloud Google OAuth login flow, in-process LocalAPI commands, and VPN TUN network debugging.
---

# XBond Android 開發與全鏈路調試指南

本技能提供 XBond Android 端（Waydroid 模擬器或真機）從源碼編譯、打包部署、WebView 遠程調試到 TUN 虛擬網卡與外網連通性驗證的完整工作流。

---

## 1. 快速構建與部署

### 完整構建與安裝流程

```bash
# 1. 構建 Go 移動端 AAR (gomobile bind)
pnpm android:bind

# 2. 編譯 Web 前端資產並打包安裝 APK (Waydroid/ADB)
pnpm android:install
```

### 僅重新編譯與安裝 APK（AAR 未變更時）

```bash
# 用 Tauri 打包並安裝至在線設備
pnpm android:install

# 只生成 debug APK
pnpm tauri android build --debug --apk
```

> [!IMPORTANT]
>
> - Android Gradle Plugin (AGP 8.x) 要求 JDK 17 或 JDK 21，高於 JDK 21（如 JDK 27）可能導致編譯異常。若系統默認 JDK 過高，可通過環境變量 `JAVA_HOME` 或用戶個人配置 `~/.gradle/gradle.properties`（設置 `org.gradle.java.home=...`）指定，切勿在倉庫受控文件中硬編碼本地絕對路徑。
> - 不要手動調用未帶 tags 的 `gomobile`，始終使用 `pnpm android:bind`，其集中管理 `MOBILE_ANDROID_TAGS`。

---

## 2. Android 運行環境與調試準備

XBond 移動端支持在 Android 真機或模擬器（如 Waydroid）中運行：

- **ADB 連接**：
  ```bash
  # 檢查當前連接設備
  adb devices

  # 若使用網絡調試（如 Waydroid 或 Wi-Fi 調試），連接對應地址
  adb connect <device-ip>:5555
  ```
- **推薦屏幕規格**：1080x1920, 420 DPI
- **Waydroid 單窗口模式配置參考**（若使用 Waydroid 作為 Linux 本機模擬器）：
  ```bash
  waydroid prop set persist.waydroid.multi_windows false
  waydroid prop set persist.waydroid.suspend false
  waydroid prop set persist.waydroid.width 1080
  waydroid prop set persist.waydroid.height 1920
  adb shell wm density 420
  ```
- **截圖檢查**：
  ```bash
  adb exec-out screencap -p > /tmp/xbond-screen.png
  ```

---

## 3. XBond Cloud 賬號登錄與協同規範

XBond 支持綁定 XBond Cloud 賬號以自動同步節點訂閱配置：

- **登錄方式**：統一使用 **Google OAuth** 登錄。
- **人機協同原則**：
  - 開發或調試需要登錄 XBond Cloud 時，通常宿主環境默認瀏覽器中已提前登錄好 Google 賬號。
  - 當點擊「登錄 XBond Cloud」跳轉至系統瀏覽器後，若發現**未登錄 Google 賬號**或彈出**安全驗證 / 雙重認證（2FA）**，**必須暫停自動化操作，交由開發者在瀏覽器中手動登錄完成**。
  - 開發者完成授權並由瀏覽器跳轉回應用（`xbond://callback`）後，再繼續後續的開發與測試工作。切勿嘗試以自動化腳本偽造授權憑據或繞過安全認證。

---

## 4. WebView 遠程調試 (CDP)

應用界面由 Android WebView 承載，啟用調試模式後，可通過 Chrome DevTools Protocol (CDP) 直接執行 JavaScript、檢查 DOM 與調試路由。

我們在 `scripts/cdp-eval.mjs` 提供了一鍵調試腳本（自動探測進程 PID 並映射 `tcp:9222`）：

```bash
# 查看當前頁面路由
.agents/skills/xbond-android-dev/scripts/cdp-eval.mjs "location.href"

# 獲取 LocalAPI 身份憑據 Token
.agents/skills/xbond-android-dev/scripts/cdp-eval.mjs 'document.querySelector("meta[name=\\"localapi-token\\"]")?.getAttribute("content")'

# 調用 LocalAPI 查詢狀態
.agents/skills/xbond-android-dev/scripts/cdp-eval.mjs '
(async () => {
  const token = document.querySelector("meta[name=\\"localapi-token\\"]")?.getAttribute("content");
  const res = await fetch("/localapi/v0/status", { headers: { "X-XBond-Token": token } });
  return await res.json();
})()
'

# 模擬點擊斷開或連接按鈕
.agents/skills/xbond-android-dev/scripts/cdp-eval.mjs '
(() => {
  const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Connect") || b.textContent.includes("Disconnect"));
  if (btn) { btn.click(); return "Clicked " + btn.textContent.trim(); }
  return "Button not found";
})()
'
```

---

## 5. 內置 LocalAPI 常用端點

移動端在進程內啟動了基於 loopback 的 LocalAPI 服務。調用時必須攜帶請求頭 `X-XBond-Token: <token>`：

| 請求路徑 | 方法 | 用途 |
| :-- | :-- | :-- |
| `/localapi/v0/status` | `GET` | 獲取核心運行狀態、三層狀態階梯、當前訂閱與 VPN 狀態 |
| `/localapi/v0/up` | `POST` | 發起 VPN 連接（觸發 Android `VpnService.prepare` / `startActive`） |
| `/localapi/v0/down` | `POST` | 斷開 VPN 連接並關閉 TUN 網卡 |
| `/localapi/v0/nodes` | `GET` | 獲取當前策略組及節點列表 |
| `/localapi/v0/nodes/test` | `POST` | 測試指定節點延遲，Body: `{"node":"...","url":"http://cp.cloudflare.com/generate_204","timeoutMs":5000}` |
| `/localapi/v0/logs` | `GET` | 讀取核心運行環形日誌 |
| `/localapi/v0/mode` | `POST` | 切換路由模式（`rule` / `global` / `direct`），Body: `{"mode":"rule"}` |

---

## 6. VPN 虛擬網卡與外網連通性診斷

當點擊連接後，執行以下命令驗證虛擬網卡與出口：

```bash
# 1. 檢查 tun0 接口是否存在
adb shell ip addr show tun0

# 2. 檢查路由表與規則
adb shell ip route show table tun0
adb shell ip rule show

# 3. 測試 ICMP 連通性
adb shell ping -c 3 1.1.1.1

# 4. 測試實際外網 HTTP/HTTPS 出口
adb shell curl -s -I -m 6 https://www.google.com
```

若遇到問題，查閱詳細排查手冊：

- [常見故障與解決方案](./references/troubleshooting.md)
