# 訂閱更新通道與版本回滾

## 範圍與入口

本規格定義訂閱拉取的更新通道（直連／自用代理／指定代理）與來源層版本回滾。入口為 `internal/sub/channel.go`、`internal/sub/versions.go`、`internal/sub/fetch.go`（ProxyURL）、`internal/daemon/runtime.go`（resolveUpdateProxy）、`internal/daemon/server.go`（`/subs` PATCH、`/subs/versions`、`/subs/rollback`），CLI 為 `sub channel`、`sub versions`、`sub rollback`。行為契約遵循重梳方案 §四.5。套用與恢復見 [運行配置](./runtime-configuration.md)，覆蓋層見 [本地覆蓋層](./config-override.md)。

## 行為契約

### 更新通道

每個訂閱持久保存更新通道：`direct`（默認）、`self`、`proxy`。`self` 經守護進程自身的 mixed 端口拉取，僅在核心運行時生效——首個配置尚不可用時不能依賴它自舉，此時按直連處理。`proxy` 經保存的 `http(s)://` 或 `socks5://` 代理拉取，保存時必須提供有效 URL；其餘通道清空該 URL。手動調用的每次覆寫（`--via-proxy`／`viaProxy` 顯式給出）優先於通道：true 強制本地代理，false 強制直連；未給出時跟隨通道。

通道失效不靜默切換：經代理拉取失敗時返回可操作錯誤（說明通道使用了本地代理，可修復或改直連），由用戶決定是否改通道；定時更新同樣跟隨通道。設置入口為 LocalAPI `PATCH /localapi/v0/subs` 的 `updateChannel`／`updateProxy` 字段、CLI `sub channel`，配置頁每卡提供通道選擇（指定代理彈出 URL 輸入）。

### 版本回滾

來源層快照：內容實際變化的更新在寫入前把上一份來源存為版本（每訂閱最多保留 5 份，超出裁剪最舊）；內容不變的更新不佔版本。回滾恢復最新一份版本，且恢復前先把當前來源存為版本——回滾本身可逆。回滾位於來源層：本地覆蓋層與守護進程擁有的派生設置原樣保留並隨即生效；與覆蓋衝突的版本回滾整體失敗，狀態保持原狀。恢復的版本經過覆蓋拼接與核心校驗閘，寫入後更新 hash 與時間並計算 diff；活躍訂閱回滾且核心運行時立即重新套用。

入口：LocalAPI `GET /localapi/v0/subs/versions?id=`（列表，最新在前）與 `POST /localapi/v0/subs/rollback`（{id}）；CLI `sub versions`、`sub rollback`；配置頁每卡「回滾」按鈕。回滾說明：回滾的是來源原文層，不是覆蓋層，也不是守護進程偏好。

## 驗收條件

| 編號 | 結果 | 驗證入口 |
| --- | --- | --- |
| UPDATE-01 | 通道解析：direct／self 自舉（核心停止→直連）／self 運行（本地代理）／proxy（存儲 URL）；顯式覆寫優先於通道 | `internal/daemon/channel_test.go` |
| UPDATE-02 | 通道設置校驗並持久化；proxy 缺 URL 拒絕；未知通道拒絕；與覆蓋層互不影響 | `internal/sub/channel_test.go` |
| UPDATE-03 | 內容變化的更新快照上一份來源並裁剪至 5 份；內容不變不佔版本 | `internal/sub/versions_test.go` |
| UPDATE-04 | 回滾恢復最新版本且可逆（當前來源先入版本）；hash/diff 更新；覆蓋隨回滾生效，衝突整體失敗保持原狀 | 同上 |
| UPDATE-05 | 經代理拉取失敗返回含通道提示的可操作錯誤，通道不變 | `internal/daemon/runtime.go`（updateLocked 包裝） |

## 已知限制

通道解析在守護進程內完成（需要引擎狀態），CLI 子進程只傳遞顯式覆寫。fetch 層的代理撥號（HTTP CONNECT、socks5 握手）未以替身服務器覆蓋，由核心閘與真實使用驗證。版本快照覆蓋同一次更新的失敗恢復路徑之外的崩潰場景由原子寫保證，不承諾跨進程崩潰的多文件原子性。移動宿主未接入。
