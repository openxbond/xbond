# 訂閱匯入與兼容邊界

## 範圍與入口

本規格定義 URL、本機檔案與貼上配置的格式檢測、雙核心歸屬、更新及錯誤回應。入口為 `internal/sub/convert.go`、`convert_nodes.go`、`migrate.go`、`sub.go`、`internal/engine/format.go`、`internal/daemon/server.go`、`cmd/xbond/cmd_sub.go`，共享介面由 LocalAPI 消費結果。執行目標見 [控制目標](./control-targets.md)，套用與恢復見 [運行配置](./runtime-configuration.md)。

## 行為契約

### 雙核心與格式原生歸屬

客戶端內嵌兩個核心，同一時間只運行一個：mihomo（主核心）原生運行 Clash YAML，sing-box（副核心）原生運行 sing-box JSON。訂閱按格式選擇核心，兩種格式都是各自核心的原生格式，原樣透傳——規則、DNS、TUN、策略組、提供者、REALITY 等全部語義由原生核心直接執行，不做任何轉換，不存在轉換損失。`engine.DetectFormat` 是格式判定與核心選擇的唯一入口；`SubscriptionMeta.Format` 記錄歸屬，`EngineStatus.Core` 對外報告當前運行的核心。

分享連結與 Base64 節點清單沒有原生格式，規範化為 Clash YAML（節點＋預設 `Proxy` select／`Auto` url-test 組＋`MATCH,Proxy`），歸 mihomo 核心。

輸入方式與格式分開：URL、檔案、貼上都走相同檢測及核心校驗；不因名稱或 URL 判定兼容。檢測與校驗是兩步：檢測失敗（無法識別的格式、Clash 文件既無內聯 `proxies` 亦無 `proxy-providers`）立即整份拒絕；透傳產物仍須通過所屬核心的校驗閘（`engine.Validate`，更新與套用前執行）才可保存。校驗中 GEOIP／GEOSITE 等規則會觸發 mihomo 按需下載 geodata，離線時此類來源校驗失敗屬預期行為；sing-box 的校驗完全離線。

### 核心切換

切換活躍訂閱或更新改變格式時，守護進程停止當前核心並以另一核心啟動新配置，恢復已保存的節點選擇；失敗整體回滾到先前核心與配置。兩個核心共用同一對連接埠與控制器設置（由守護進程擁有），對外 Clash API 介面一致，UI 與 CLI 不感知差異。mihomo 的綁定失敗不會使啟動報錯，引擎以就緒探針（控制器 `/version` ＋ mixed 端口行為探測）還原「端口衝突→回滾」的保證；sing-box 的綁定失敗原生同步報錯。

### 存量來源遷移

雙核心切換後，舊版未記錄格式的訂閱在守護進程啟動時由 `MigrateLegacySources` 一次性補記 `Format`（按 `DetectFormat` 判定），不改寫任何來源位元組；兩種核心都不認得的來源標記暫態錯誤並提示更新或重新導入。遷移在任何人能套用運行配置之前完成。

### 分享連結與 Base64

支援明文連結清單及標準／URL-safe Base64，分別接受有／無 padding。首期分享連結支援 Trojan 與 VLESS 的已實作選項，包括基本 TCP、TLS 及 WebSocket；其他協定或選項回報所在行，整份拒絕。節點憑據缺失、壞 URL、未知選項與重複選項均不能跳過後仍回報成功。不含已知協定 scheme 的文本以「無法識別的格式」拒絕，不產生逐行誤導錯誤。

錯誤只包含固定說明、欄位與清單位置，不包含完整 URI、節點密碼或來源原文。解析後仍由所屬核心作完整校驗；格式可解析不等於能連線。

### 保存、啟用與更新

保存來源、取得配置、校驗通過、切換活躍來源及核心套用是不同結果。初次檢測或下載失敗可保留來源供重試，回傳 `updateError`，不得因此自動啟用來源；原有活躍來源及核心保持原狀。用戶之後明確啟用是另一項操作，不能因持久化中缺少 activeId 而隱式啟用新項。

圖形介面收到 `updateError` 保留輸入並顯示失敗與原因，不清空表單或顯示導入成功。後續更新檢測或校驗失敗時，保留上一份有效下載配置、hash、成功時間及運行狀態。

XBond 閘道訂閱以 `target=clash` 取得 Clash YAML（UA `xbond/<v> mihomo/<v>`）；配額、ETag、更新間隔與網頁 URL 行為不變。

## 驗收條件

| 編號 | 結果 | 驗證入口 |
| --- | --- | --- |
| IMPORT-01 | Clash YAML 原樣透傳並歸 mihomo；sing-box JSON 原樣透傳並歸 sing-box；位元組不變；配額註釋照常解析 | `internal/sub/compatibility_test.go` |
| IMPORT-02 | 兩種格式都通過所屬核心校驗；壞配置在核心校驗閘被拒；無 proxies／providers 的 Clash 文件與無 outbounds 的 JSON 在檢測層拒絕 | 同上；`internal/engine.Validate` |
| IMPORT-03 | 任一分享連結無效則整份失敗且錯誤不含憑據；四種 Base64 均接受並產生可用 Clash 文檔 | 同上 |
| IMPORT-04 | 失敗更新保留有效配置、hash、時間與活躍狀態；兩種格式分別記錄並持久化 | 同上 |
| IMPORT-05 | LocalAPI 校驗失敗維持活躍來源及核心；有效配置才套用 | `internal/daemon/import_test.go`、`server_test.go` |
| IMPORT-06 | 啟動遷移只補記 Format，不改寫來源；不可識別來源標記錯誤 | `internal/sub/migrate_test.go` |
| IMPORT-07 | 同一 manager 先後啟動兩個核心：Clash API、節點選擇與狀態 `Core` 欄位對兩者一致；格式切換回到原核心 | `internal/engine/engine_test.go`；真實 daemon 冒煙 |

## 已知限制

兩個核心同時內嵌使二進制體積增大；同一時間仍只運行一個核心。Windows 上快速來回切換核心可能遇到端口釋放延遲，切換失敗會整體回滾並可重試。mihomo 的 GEOIP／GEOSITE 規則在首次校驗與啟動時需要下載 geodata；離線環境失敗屬核心行為。分享連結首期僅支援 Trojan 與 VLESS。來源端口跟隨與本機固定端口覆蓋的解析、生效及展示規則由運行配置契約（runtime-configuration.md）定義。完整覆蓋編輯、代理更新路徑、版本回滾與原生 VPN 也不由本規格推定完成。

測試使用臨時資料、loopback 及核心替身；配置經核心驗證不證明真實節點、TLS 對端或外部連通成功。Clash 欄位參考 [Mihomo 文檔](https://wiki.metacubex.one/)，sing-box 欄位以其釘定版本的選項結構為準，實際接受範圍以釘定依賴與驗收共同核對。
