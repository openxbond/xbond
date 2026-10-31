# 賬戶與服務狀態

## 範圍與入口

本規格定義原生客戶端讀取用戶身份、服務狀態、公告與可信控制台入口的契約，以及登出與緩存清理。入口為 `internal/clientapi/account.go`、`internal/account/account.go`、`internal/daemon/account.go`、`internal/platform/paths/paths.go`（AccountOverviewPath），共享介面由 LocalAPI 的 `/account` 族消費。OAuth 會話與流程見內部帳戶模組；訂閱匯入見 [訂閱匯入與兼容邊界](./subscription-import.md)。

## 行為契約

### 概覽讀取

守護進程以保存的 OAuth 會話（自動刷新、旋轉令牌回寫）對 Cloud 發一次 tRPC 批量讀取：身份 `user.profile.me`、服務狀態 `user.billing.subscription`、公告 `user.notifications.list`。身份是權威讀取：UNAUTHORIZED 觸發一次強制刷新重試，仍失敗則整體報錯。服務與公告讀取各自退化——讀取失敗只讓對應部分缺失（空列表與讀取失敗以 nil／空區分），不阻斷身份展示，退化以 `overviewError` 呈現。令牌集合永不離開守護進程；LocalAPI 消費者只看到 `AccountState`。

### 緩存與展示

最近一次成功的概覽以 0600 緩存於數據目錄（account-overview.json），守護進程啟動時立即展示緩存並在後台刷新；刷新失敗保留緩存並上報 `overviewError`。控制台入口由會話自身的 origin 推導（`{origin}/dash`）——是簽發令牌的發行方，不是用戶輸入。登錄成功後、狀態翻轉為 signed_in 之前完成首次同步；刷新（resync）同樣同步刷新概覽。登出時遞增同步代數，遲到的後台同步不得復原已重置的狀態。

### 服務狀態語義

「已登入而無服務」可判定：billing 關閉收縮為 `plan: "free"`、`enabled: false`；`quotaState: "blocked"` 表示流量用盡；`servicePeriodEnd` 為空或過去表示到期。客戶端只展示狀態與跳轉控制台，不自動替換普通（第三方）配置，也不在客戶端內購買。

### 登出與緩存清理

登出按 RFC 7009 對刷新令牌調用發行方的 revocation 端點（盡力而為：網絡失敗不阻止本地登出），隨後刪除會話文件、概覽緩存與全部 xbond 型訂閱；普通訂閱保留。遠端會話的剩餘授權（PKCE sid 綁定的瀏覽器會話）由控制台管理，客戶端登出不等於遠端全面吊銷。

## 驗收條件

| 編號 | 結果 | 驗證入口 |
| --- | --- | --- |
| ACCOUNT-01a | 概覽批量讀取三過程、身份 401 映射刷新重試、服務／公告讀取獨立退化且空列表不等於失敗 | `internal/clientapi` 測試 |
| ACCOUNT-01b | 概覽同步折入狀態（身份、服務、控制台連結）、旋轉令牌回寫會話、緩存落盤 | `internal/account`、`internal/daemon` 測試 |
| ACCOUNT-01c | 登出撤銷刷新令牌（盡力而為）、刪除會話與概覽緩存、遲到同步不復原狀態 | 同上 |
| ACCOUNT-01d | 啟動展示緩存概覽，Cloud 失敗保留緩存並上報 overviewError | `internal/daemon` 測試 |
| ACCOUNT-01e | Cloud 側 `user.profile.me` 為 Bearer 可讀身份出口，路由快照釘住 | cloud `client-oauth.test.ts`、`routes.snapshot.test.ts` |

## 已知限制

通知為輪讀，無推送通道；已讀標記（markRead 族）本切片未接入客戶端。緩存寫入失敗只損失啟動時的新鮮度，不作為錯誤上報。控制台入口假設 dash 掛在發行方 origin 的 `/dash` 路徑。測試使用 tRPC 批量替身，不證明真實 Cloud 部署、配額數值或公告內容的正確性。
