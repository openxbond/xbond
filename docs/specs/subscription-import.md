# 訂閱匯入與兼容邊界

## 範圍與入口

本規格定義 URL、本機檔案與貼上配置的格式轉換、顯式 Clash 節點模式、更新及錯誤回應。入口為 `internal/sub/convert.go`、`convert_nodes.go`、`sub.go`、`internal/daemon/server.go`、`cmd/xbond/cmd_sub.go`，共享介面由 LocalAPI 消費結果。執行目標見 [控制目標](./control-targets.md)，套用與恢復見 [運行配置](./runtime-configuration.md)。

## 行為契約

### 預設完整度檢查

輸入方式與格式分開：URL、檔案、貼上都走相同轉換及核心校驗。sing-box JSON 保留來源設定，通過目前釘定核心校驗才可使用；不因名稱或 URL 判定兼容。

Clash 首期支援內聯節點及可表達的 `select`／`url-test` 策略組子集。節點型別包含基本 Shadowsocks、Trojan、VLESS、VMess、SOCKS5、HTTP；TLS、WebSocket 等選項僅接受已實作的欄位與型別。支援型別不代表全部插件、傳輸或 TLS 擴展均可用。

未實作的頂層欄位、節點欄位、傳輸及策略組明確拒絕，不靜默丟棄。`fallback`、`load-balance` 不轉成 `url-test`；未知型別、重名或保留名稱、無法解析的參照與策略組循環引用均須在保存有效配置前拒絕。核心的部分依賴檢查延至啟動，不能只以 options／instance 建立成功作為策略圖有效的證據。策略組子集以第一組為預設出口；只有節點時建立下述預設節點策略。

本期不轉換完整 Clash 規則、DNS、提供者、端口、TUN、插件、REALITY 等未實作語義。要完整保留設定，使用相容的 sing-box JSON；要捨棄 Clash 原設定，使用下面的顯式選擇。未提供非空內聯節點的提供者型配置明確拒絕，不當作分享連結清單處理。

### 顯式 Clash 節點模式

圖形介面預設不勾選「只匯入 Clash 節點」。用戶勾選前可讀到其後果：捨棄原規則、DNS、端口及策略組，使用預設節點策略；不支援的節點仍拒絕整份來源。

CLI 使用 `xbond sub add <url|file> --clash-nodes-only`；LocalAPI 的匯入請求使用 `clashNodesOnly: true`。此選擇只適用於 Clash YAML，sing-box JSON、分享連結及 XBond 憑據不接受該選擇。設定隨來源保存，自動／手動更新與進程重啟後繼續使用，不在更新時自行退回或啟用。

節點模式只使用內聯 `proxies`，建立 direct 出站、手動 selector 及 urltest，預設路由走 selector 的自動選擇。產生的標籤避免與節點名稱碰撞；不產生已被釘定核心移除的 block 出站。名稱、伺服器、端口、認證與支援的傳輸選項保留，不能因勾選節點模式而忽略未知節點設定。

同一 URL 或同一貼上內容的嚴格模式與節點模式使用不同來源身份，不能覆寫對方的已知有效配置。重新匯入既有身份時，在下一次成功更新前保留原有 hash、成功時間、配額、快取資訊及節點選擇。

### 分享連結與 Base64

支援明文連結清單及標準／URL-safe Base64，分別接受有／無 padding。首期分享連結支援 Trojan 與 VLESS 的已實作選項，包括基本 TCP、TLS 及 WebSocket；其他協定或選項回報所在行，整份拒絕。節點憑據缺失、壞 URL、未知選項與重複選項均不能跳過後仍回報成功。

錯誤只包含固定說明、欄位與清單位置，不包含完整 URI、節點密碼或來源原文。解析後仍由釘定核心作完整校驗；格式可解析不等於能連線。

### 保存、啟用與更新

保存來源、取得配置、校驗通過、切換活躍來源及核心套用是不同結果。初次轉換或下載失敗可保留來源供重試，回傳 `updateError`，不得因此自動啟用來源；原有活躍來源及核心保持原狀。用戶之後明確啟用是另一項操作，不能因持久化中缺少 activeId 而隱式啟用新項。

圖形介面收到 `updateError` 保留輸入並顯示失敗與原因，不清空表單或顯示匯入成功。成功的節點模式來源有可辨認標記。後續更新轉換或校驗失敗時，保留上一份有效下載配置、hash、成功時間及運行狀態，不自行改成節點模式。

## 驗收條件

| 編號 | 結果 | 驗證入口 |
| --- | --- | --- |
| IMPORT-01 | 未實作的頂層／節點欄位與不等價策略組明確失敗，不產生部分成功 | `internal/sub/compatibility_test.go` |
| IMPORT-02 | 顯式節點模式捨棄原策略但保留支援的 WS／TLS，生成配置通過釘定核心校驗 | 同上；`internal/engine.Validate` |
| IMPORT-03 | 任一分享連結無效則整份失敗且錯誤不含憑據；四種 Base64 均接受 | 同上 |
| IMPORT-04 | 模式持久化／重啟／更新一致；兩種模式身份隔離；失敗與重匯入不覆蓋有效配置及 metadata | 同上 |
| IMPORT-05 | LocalAPI 嚴格模式失敗維持活躍來源及核心；顯式節點模式才套用；拒絕 Cloud 套用此選擇 | `internal/daemon/import_test.go`、`server_test.go` |
| IMPORT-06 | UI 三種輸入與管理頁傳遞顯式選擇，失敗不報成功；模式在 client DTO 及來源標記保留 | `packages/client/tests/subscription-wire.test.ts`；隔離瀏覽器流程 |

## 已知限制

這是兼容邊界與顯式節點匯入切片，不是完整 Clash／Mihomo 配置轉譯器，也不擴展所有分享協定。來源端口優先於預設 7890、本機固定端口覆蓋的解析與生效規則另行交付；本片不宣稱已完成端口跟隨。完整覆蓋編輯、代理更新路徑、版本回滾與原生 VPN 也不由本片推定完成。

測試使用臨時資料、loopback 及核心替身；配置經核心驗證不證明真實節點、TLS 對端或外部連通成功。WS/TLS 欄位參考 [sing-box transport](https://sing-box.sagernet.org/configuration/shared/v2ray-transport/)與 [Mihomo transport](https://github.com/MetaCubeX/Meta-Docs/blob/main/docs/config/proxies/transport.en.md)，實際接受範圍以釘定依賴與驗收共同核對。
