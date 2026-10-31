# 訂閱匯入與兼容邊界

## 範圍與入口

本規格定義 URL、本機檔案與貼上配置的格式規範化、顯式節點模式、更新及錯誤回應。入口為 `internal/sub/convert.go`、`convert_nodes.go`、`migrate.go`、`sub.go`、`internal/daemon/server.go`、`cmd/xbond/cmd_sub.go`，共享介面由 LocalAPI 消費結果。執行目標見 [控制目標](./control-targets.md)，套用與恢復見 [運行配置](./runtime-configuration.md)。

## 行為契約

### 內部規範格式與核心校驗

內部規範格式是 Clash（mihomo）YAML：所有來源在匯入時規範化為它，`config.source` 持有規範化結果。輸入方式與格式分開：URL、檔案、貼上都走相同轉換及核心校驗；不因名稱或 URL 判定兼容。

Clash YAML 是核心原生格式，原樣透傳（規則、DNS、TUN、`fallback`／`load-balance` 策略組、`proxy-providers` 等全部語義由核心直接執行），僅解析 `# subscription-userinfo:` 註釋取得配額。透傳不做深度校驗；可用性由釘定核心的校驗閘（`engine.Validate`，更新與套用前執行）裁決。既無內聯 `proxies` 亦無 `proxy-providers` 的文件直接拒絕。

sing-box JSON 轉換為 Clash：節點類型 Shadowsocks、Trojan、VLESS（含 REALITY＋uTLS）、VMess、SOCKS5、HTTP 逐欄位映射；`selector`／`urltest` 對應 `select`／`url-test`；route 規則映射 `DOMAIN`／`DOMAIN-SUFFIX`／`DOMAIN-KEYWORD`／`DOMAIN-REGEX`／`GEOSITE`／`GEOIP`／`IP-CIDR`／`DST-PORT` 及 `MATCH`。無法映射的內容——未知出站類型、DNS 段、`rule_set`、邏輯規則、未知欄位——明確拒絕並指出位置，不靜默降級。`inbounds`、`experimental`、`log` 描述客戶端本身（監聽、控制器、日誌），由守護進程接管，丟棄不算丟失訂閱內容。

規範化與校驗是兩步：檢測轉換失敗立即整份拒絕；轉換產物仍須通過核心校驗才可保存。校驗中 GEOIP／GEOSITE 等規則會觸發核心按需下載 geodata，離線時此類來源校驗失敗屬預期行為。

### 顯式節點模式

「僅導入節點」是 sing-box JSON 的逃生口：捨棄其規則、DNS 與策略組，只保留可轉換節點並建立預設 `Proxy`（select）與 `Auto`（url-test）組，路由 `MATCH,Proxy`。Clash YAML 原樣運行無損失，此勾選對其無效果；分享連結本身只有節點，同樣無效果。

CLI 使用 `xbond sub add <url|file> --clash-nodes-only`；LocalAPI 的導入請求使用 `clashNodesOnly: true`。設定隨來源保存，自動／手動更新與進程重啟後繼續使用，不在更新時自行退回或啟用。

同一 URL 或同一貼上內容的嚴格模式與節點模式使用不同來源身份，不能覆寫對方的已知有效配置。重新導入既有身份時，在下一次成功更新前保留原有 hash、成功時間、配額、快取資訊及節點選擇。

### 存量來源遷移

核心由 sing-box 換為 mihomo 後，舊版保存的 sing-box JSON 來源在守護進程啟動時一次性遷移（`MigrateLegacySources`）：先嚴格轉換；無法保留語義時退回節點模式並在 meta 記錄 `ClashNodesOnly`，保證用戶不掉線；完全不可轉換的來源標記暫態錯誤並提示更新或重新導入，來源原文保留。遷移在任何人能套用運行配置之前完成。

### 分享連結與 Base64

支援明文連結清單及標準／URL-safe Base64，分別接受有／無 padding。首期分享連結支援 Trojan 與 VLESS 的已實作選項，包括基本 TCP、TLS 及 WebSocket；其他協定或選項回報所在行，整份拒絕。節點憑據缺失、壞 URL、未知選項與重複選項均不能跳過後仍回報成功。不含已知協定 scheme 的文本以「無法識別的格式」拒絕，不產生逐行誤導錯誤。

錯誤只包含固定說明、欄位與清單位置，不包含完整 URI、節點密碼或來源原文。解析後仍由釘定核心作完整校驗；格式可解析不等於能連線。

### 保存、啟用與更新

保存來源、取得配置、校驗通過、切換活躍來源及核心套用是不同結果。初次轉換或下載失敗可保留來源供重試，回傳 `updateError`，不得因此自動啟用來源；原有活躍來源及核心保持原狀。用戶之後明確啟用是另一項操作，不能因持久化中缺少 activeId 而隱式啟用新項。

圖形介面收到 `updateError` 保留輸入並顯示失敗與原因，不清空表單或顯示導入成功。成功的節點模式來源有可辨認標記。後續更新轉換或校驗失敗時，保留上一份有效下載配置、hash、成功時間及運行狀態，不自行改成節點模式。

XBond 閘道訂閱以 `target=clash` 取得原生 Clash YAML（UA `xbond/<v> mihomo/<v>`）；配額、ETag、更新間隔與網頁 URL 行為不變。

## 驗收條件

| 編號 | 結果 | 驗證入口 |
| --- | --- | --- |
| IMPORT-01 | Clash YAML（含規則、DNS、fallback/load-balance、providers）原樣透傳並通過核心校驗；無 proxies 亦無 providers 的文件拒絕 | `internal/sub/compatibility_test.go` |
| IMPORT-02 | sing-box JSON 嚴格轉換：支援節點/策略組/規則映射；DNS、rule_set、未知類型、邏輯規則明確拒絕；節點模式僅保留節點並通過核心校驗 | 同上；`internal/engine.Validate` |
| IMPORT-03 | 任一分享連結無效則整份失敗且錯誤不含憑據；四種 Base64 均接受 | 同上 |
| IMPORT-04 | 模式持久化／重啟／更新一致；兩種模式身份隔離；失敗與重導入不覆蓋有效配置及 metadata | 同上 |
| IMPORT-05 | LocalAPI 校驗失敗維持活躍來源及核心；有效配置才套用；拒絕 Cloud 套用節點模式選擇 | `internal/daemon/import_test.go`、`server_test.go` |
| IMPORT-06 | 啟動遷移：sing-box JSON 來源轉為規範 Clash YAML；DNS 段退回節點模式並記錄；不可轉換來源標記錯誤且原文保留 | `internal/sub/migrate_test.go` |
| IMPORT-07 | UI 三種輸入與管理頁傳遞顯式選擇，失敗不報成功；模式在 client DTO 及來源標記保留 | `packages/client/tests/subscription-wire.test.ts`；隔離瀏覽器流程 |

## 已知限制

sing-box JSON 轉換不是完整規則轉譯器：rule_set、邏輯規則、DNS 段不映射。Clash YAML 完整語義由 mihomo 核心原生執行，但核心自身的能力邊界（插件傳輸、實驗特性）不受本規格擴展。GEOIP／GEOSITE 規則在首次校驗與啟動時需要下載 geodata；離線環境失敗屬核心行為。來源端口優先於預設 7890、本機固定端口覆蓋的解析與生效規則另行交付；本規格不宣稱已完成端口跟隨。完整覆蓋編輯、代理更新路徑、版本回滾與原生 VPN 也不由本規格推定完成。

測試使用臨時資料、loopback 及核心替身；配置經核心驗證不證明真實節點、TLS 對端或外部連通成功。sing-box 欄位參考 [sing-box transport](https://sing-box.sagernet.org/configuration/shared/v2ray-transport/)，Clash 欄位參考 [Mihomo 文檔](https://wiki.metacubex.one/)，實際接受範圍以釘定依賴與驗收共同核對。
