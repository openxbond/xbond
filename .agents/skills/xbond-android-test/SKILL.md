---
name: xbond-android-test
description: >-
  Use this skill to run automated end-to-end smoke testing, TUN egress verification, and health diagnostics on the XBond Android application.
---

# XBond Android 自動化冒煙測試與健康診斷

本技能提供 XBond Android 端的自動化冒煙測試工具，用於在 5 秒內完成「設備在線 -> 進程拉起 -> DevTools 橋接 -> LocalAPI 狀態階梯驗證 -> TUN 出口流量實測 -> 界面截圖存檔」的全自動驗證。

---

## 1. 執行冒煙測試

在連接了 Android 真機或模擬器（如 Waydroid）的環境下執行：

```bash
node .agents/skills/xbond-android-test/scripts/smoke-test.mjs
```

### 驗收項目清單

測試腳本會依次驗證以下 6 項指標：

1. **ADB 設備在線**：動態檢測 `adb devices` 中的在線設備。
2. **進程生命週期**：檢查 `net.xbond.app` 進程，若未啟動則自動通過 Activity Manager 拉起並等待就緒。
3. **WebView CDP 探針**：自動探測進程 PID 並映射 `tcp:9222`，與 WebView 內部建立 WebSocket 連接。
4. **LocalAPI 狀態階梯**：從 DOM 的 `<meta name="localapi-token">` 安全提取憑據，調用 `/localapi/v0/status` 驗證核心運行、策略組與節點同步狀態。
5. **出口連通性驗證**（當 VPN 處於 Connected 狀態時）：
   - ICMP Ping 測試（如 `1.1.1.1`）。
   - 真實 HTTPS 外網出口請求（如 `curl -s -I -m 6 https://www.google.com`），確保用戶態 gVisor 協議棧與 TUN 轉發正常。
6. **UI 視覺快照**：自動將當前界面截圖保存至 `/tmp/xbond-android-smoke.png`，便於視覺驗證。

---

## 2. 輸出範例

```text
=== XBond Android Smoke Test ===
✅ ADB device connected: <device-serial>
✅ App running with PID: 5951
✅ DevTools port forwarded (tcp:9222)
✅ LocalAPI online:
   - VPN State: CONNECTED
   - Core: sing-box (running: true)
   - Takeover: tun, Routing: rule
   - Active Sub: XBond Cloud (sing-box)
✅ ICMP Ping (1.1.1.1): min/avg/max/mdev = 42.1/43.5/45.2/1.1 ms
✅ Internet Egress (curl https://www.google.com): HTTP/1.1 200 OK
✅ UI Screenshot saved to: /tmp/xbond-android-smoke.png
=== Smoke Test Completed Successfully! ===
```

若有任何步驟失敗，腳本會以非零退出碼中斷並輸出具體錯誤原因。
