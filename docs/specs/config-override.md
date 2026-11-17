# 本地覆蓋層

## 範圍與入口

本規格定義訂閱的結構化本地覆蓋：來源原文 → 本地覆蓋 → 宿主派生 → 校驗後運行配置四層中的第二層（重梳方案 §四）。下載緩存永不改寫；覆蓋是獨立持久層，隨每次更新與套用自動生效。入口為 `internal/engine/override.go`（規則組展開、目標校驗、DNS 上游套用）、`internal/engine/customrule.go`（域名／IP／CIDR 歸一化）、`internal/sub/override.go`（存儲與保存校驗）、`internal/daemon/server.go`（`/localapi/v0/subs/override`、`/localapi/v0/subs/policies`）、`internal/daemon/runtime.go`（套用接入），共享介面由 LocalAPI 與配置頁覆蓋對話框消費。匯入與校驗見 [訂閱匯入與兼容邊界](./subscription-import.md)，套用與恢復見 [運行配置](./runtime-configuration.md)。

## 行為契約

### 覆蓋形狀與拼接

覆蓋只有兩部分：規則組與 DNS 上游，兩者都按當前訂閱的策略詞彙落成核心方言。全域覆蓋層已移除——每份覆蓋只屬於一個訂閱，切換訂閱不會把別人的規則帶過來。

規則組 `groups`：`{name, target, enabled, rules[]}`。同一組共用一個出口、可整組啟停；組序即優先序，組內按行序。展開順序為所有啟用組 + 來源規則（不再有前置／追加兩個插槽）。

每條規則只填域名、IP 或 CIDR，由 `ParseCustomRule` 歸一化（接受粘貼形態：完整 URL、`host:port`、`host/path`、`*.example.com`、`.example.com`）：

- 域名沿用 `DOMAIN-SUFFIX` 語義（含子域名），小寫去尾點；
- 單 IP 折算 `/32` 或 `/128`；CIDR 前綴越界直接拒絕；
- Clash 渲染 `DOMAIN-SUFFIX` / `IP-CIDR` / `IP-CIDR6`（IP 規則固定 `no-resolve`），sing-box 渲染 `domain_suffix` / `ip_cidr`，兩者同口徑（只匹配字面目的地址，不先做 DNS 解析）。

限制：最多 10 組、每組 50 條、合計 100 條。空白行提交前剔除，空組不入庫；組名留空時由 daemon 補「Group N」。

`target` 從該訂閱自己的策略組讀取：Clash 取 `proxy-groups`（無組時回落 `proxies` 的節點），sing-box 取 `selector`／`urltest` 出站（無組時回落全部出站），再加 `DIRECT`／`REJECT`。`GET /localapi/v0/subs/policies?id=` 提供的正是這份清單，保存時按同一份策略集合校驗。

DNS 上游 `dns`：`{nameservers[], fallback[]}` 兩份地址列表，每項是 IP、主機名或 DNS URL（`udp`／`tcp`／`tls`／`https`／`http`／`dhcp`），每份上限 8 條。`nameservers` 是主解析列表；`fallback` 是 Clash 的污染復核列表（語義不同，故分開），僅在至少有一個主上游時允許保存，且與主列表重複的條目被剔除。

- Clash：`nameservers` 寫入來源 `nameserver`；`fallback` 有值時替換來源 `fallback`（含無中生有），無值時刪除來源 `fallback`——覆蓋一旦存在就接管 DNS，來源殘留的 fallback 不得對新主列表做二次裁決。校驗閘以 `suppressFallbackGeoIP` 兜底，引入 fallback 不觸發 MMDB 下載。
- sing-box：沒有 fallback 機制，帶 `fallback` 的覆蓋在保存與套用時整體拒絕。`nameservers` 以 `dns-custom-N` 標籤追加 server，並把 `final` 指向第一個；來源既有的 server 與 rules 保留，按域名分流仍然有效。

零值覆蓋不寫文件、不改變任何行為。

### 衝突契約

規則組的 `target` 必須存在於來源的策略集合（策略組、節點，或內建 `DIRECT`／`REJECT`；sing-box 的 `DIRECT`／`REJECT` 渲染為原生 `direct`／`reject` 動作，不依賴訂閱是否帶同名出站）。DNS 上游逐項校驗格式。

- **保存時**：欄位歸一化後，以當前存儲來源試拼合併文檔並過核心校驗閘；未知出口、非法條目、非法 DNS 上游或校驗失敗的覆蓋被整體拒絕，已存文件不動。
- **更新時**：上游更新在寫入前以新來源試拼；覆蓋引用的策略組被上游移除時，更新按失敗處理（返回衝突說明、meta 記錄暫態錯誤），最後一份有效來源、hash 與運行狀態保持原狀——禁止靜默改指其他出口。
- **套用時**：派生前拼接；衝突在核心觸碰之前整體報錯，先前核心與偏好保持原狀。
- 活躍訂閱保存覆蓋成功且核心運行時立即重新套用；失敗回傳衝突說明，已保存的覆蓋保留供編輯。

### 存儲與介面

覆蓋以 0600 JSON 存於訂閱目錄（override.json），與來源、meta 同級；損壞的覆蓋文件是讀取錯誤而非靜默重置。LocalAPI：`GET /localapi/v0/subs/override?id=` 讀取（無覆蓋返回空對象，已歸一化）；`PUT` 以 `{id, groups, dns}` 保存；`GET /localapi/v0/subs/policies?id=` 列出可選出口。移除訂閱時其覆蓋隨訂閱目錄一併刪除。

## 驗收條件

| 編號 | 結果 | 驗證入口 |
| --- | --- | --- |
| OVERRIDE-01 | 兩種格式按組序展開於來源規則之前、來源其餘內容原樣保留、合併文檔過核心校驗閘；零值覆蓋為恆等 | `internal/engine/override_groups_test.go` |
| OVERRIDE-02 | 未知出口、非法條目在拼接層拒絕；`DIRECT`／`REJECT` 在 sing-box 渲染原生動作 | 同上 |
| OVERRIDE-06 | DNS 主/備列表按格式落成 `nameserver`+`fallback`／`dns-custom-N`；fallback 無值時刪除來源列表、sing-box 帶 fallback 拒絕；非法上游、fallback 缺主列表與超限拒絕 | 同上 |
| OVERRIDE-07 | 域名／IP／CIDR 歸一化與粘貼形態剝殼；非法輸入（越界前綴、前導零 IP、zone id）拒絕 | `internal/engine/customrule_test.go` |
| OVERRIDE-08 | 策略清單按「組優先、節點回落」給出並含內建項 | `internal/engine/override_groups_test.go` |
| OVERRIDE-03 | 保存時歸一化並對當前來源校驗，衝突拒絕且已存文件不動；round-trip 與清零刪除成立 | `internal/sub/override_test.go` |
| OVERRIDE-04 | 上游移除被引用策略組 → 更新整體失敗、來源與 hash 保持原狀、meta 記錄衝突 | 同上 |
| OVERRIDE-05 | 套用時覆蓋抵達運行配置；衝突失敗保留先前核心與偏好；清零恢復乾淨套用 | `internal/daemon/runtime_test.go` |
| OVERRIDE-09 | 移動宿主同一契約：覆蓋 round-trip、策略清單、未知出口拒絕、派生前合併 | `mobile/server_test.go` |

## 已知限制

策略組編輯與高級原文編輯屬後續切片；原文編輯仍走訂閱源編輯入口。核心閘始終是語義權威。測試使用臨時數據與核心校驗閘，不證明真實節點連通或策略組行為。桌面與移動共用同一契約，但 TUN、系統代理與原生 VPN 仍各自驗證。
