# 本地覆蓋層

## 範圍與入口

本規格定義訂閱的結構化本地覆蓋：來源原文 → 本地覆蓋 → 宿主派生 → 校驗後運行配置四層中的第二層（重梳方案 §四）。下載緩存永不改寫；覆蓋是獨立持久層，隨每次更新與套用自動生效。入口為 `internal/engine/override.go`（拼接與衝突檢測）、`internal/sub/override.go`（存儲與保存校驗）、`internal/daemon/server.go`（`/localapi/v0/subs/override`）、`internal/daemon/runtime.go`（套用接入），共享介面由 LocalAPI 與配置頁覆蓋對話框消費。匯入與校驗見 [訂閱匯入與兼容邊界](./subscription-import.md)，套用與恢復見 [運行配置](./runtime-configuration.md)。

## 行為契約

### 覆蓋形狀與拼接

覆蓋含規則拼接與 DNS 覆蓋。規則：`rulesPrepend` 與 `rulesAppend`，按訂閱格式解釋——Clash YAML 的每條覆蓋是 `TYPE,PAYLOAD,POLICY` 行（MATCH 取第二段、AND/OR/NOT 取最後一段為策略）；sing-box JSON 的每條覆蓋是一個規則 JSON 對象行。拼接順序為 前置 + 來源規則 + 追加。

DNS：`dns` 字段為原始覆蓋文本，按訂閱格式解析——Clash YAML 映射或 sing-box JSON 對象——並與來源 `dns` 段深合併：嵌套映射遞迴合併（如 `nameserver-policy` 增鍵），標量與列表整體替換。零值覆蓋不寫文件、不改變任何行為。高級原文編輯與其餘字段屬後續切片。

### 衝突契約

覆蓋引用的策略必須存在於合併後文檔可達的策略集合（節點、策略組、內建 DIRECT/REJECT 等）。sing-box DNS 的引用同樣核對：服務器 `detour` 必須指向存在的出站，DNS 規則的 `server` 必須指向合併後存在的 DNS 服務器標籤；Clash 的 DNS 段無策略引用，交由核心校驗閘：

- **保存時**：以當前存儲來源試拼合併文檔並過核心校驗閘；衝突、畸形 DNS 文本或校驗失敗的覆蓋被整體拒絕，已存文件不動。
- **更新時**：上游更新在寫入前以新來源試拼；覆蓋引用的節點或分組被上游移除時，更新按失敗處理（返回衝突說明、meta 記錄暫態錯誤），最後一份有效來源、hash 與運行狀態保持原狀——禁止靜默改指其他節點。
- **套用時**：派生前拼接；衝突在核心觸碰之前整體報錯，先前核心與偏好保持原狀。
- 活躍訂閱保存覆蓋成功且核心運行時立即重新套用；失敗回傳衝突說明，已保存的覆蓋保留供編輯。

### 存儲與介面

覆蓋以 0600 JSON 存於訂閱目錄（override.json），與來源、meta 同級；損壞的覆蓋文件是讀取錯誤而非靜默重置。LocalAPI：`GET /localapi/v0/subs/override?id=` 讀取（無覆蓋返回空對象）；`PUT` 以 `{id, rulesPrepend, rulesAppend}` 保存。移除訂閱時其覆蓋隨訂閱目錄一併刪除。

## 驗收條件

| 編號 | 結果 | 驗證入口 |
| --- | --- | --- |
| OVERRIDE-01 | 兩種格式拼接順序正確（前置＋來源＋追加）、來源其餘內容原樣保留、合併文檔過核心校驗閘；零值覆蓋為恆等 | `internal/engine/override_test.go` |
| OVERRIDE-02 | 引用缺失策略／出站、畸形規則行在拼接層拒絕；類型錯誤的規則對象在核心閘拒絕 | 同上 |
| OVERRIDE-06 | DNS 覆蓋按格式解析並深合併（嵌套映射遞迴、標量與列表替換）、合併文檔過核心閘；畸形文本與 sing-box DNS 引用衝突（detour／server）拒絕 | `internal/engine/override_test.go` |
| OVERRIDE-03 | 保存時對當前來源校驗，衝突拒絕且已存文件不動；round-trip 與清零刪除成立 | `internal/sub/override_test.go` |
| OVERRIDE-04 | 上游移除被引用節點 → 更新整體失敗、來源與 hash 保持原狀、meta 記錄衝突 | 同上 |
| OVERRIDE-05 | 套用時覆蓋抵達運行配置；衝突失敗保留先前核心與偏好；清零恢復乾淨套用 | `internal/daemon/runtime_test.go` |

## 已知限制

TUN、策略組編輯與高級原文編輯屬後續切片。衝突檢測解析規則行的策略字段，邏輯規則取最後一段；核心閘始終是語義權威。測試使用臨時數據與核心校驗閘，不證明真實節點連通或策略組行為。移動宿主未接入覆蓋。
