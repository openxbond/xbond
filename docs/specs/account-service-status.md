# 賬戶與服務狀態

## 範圍與入口

本規格定義原生客戶端讀取用戶身份、服務狀態、公告與可信控制台入口的契約，以及瀏覽器授權登入、登出與緩存清理。入口為 `internal/clientapi/account.go`、`internal/account/account.go`、`internal/account/oauth.go`（PKCE／設備流）、`internal/daemon/account.go`、`internal/platform/paths/paths.go`（AccountOverviewPath），共享介面由 LocalAPI 的 `/account` 族消費。訂閱匯入見 [訂閱匯入與兼容邊界](./subscription-import.md)。

## 行為契約

### 瀏覽器登入

登入默認走 PKCE 授權碼流：守護進程在本機回環隨機端口開回調監聽，經系統瀏覽器完成授權（RFC 8252：授權服務器允許回跳端口可變），換到的令牌集合落盤後再解析訂閱鏈路。回環監聽打不開或以 `device` 顯式請求時降級為 RFC 8628 設備流（Docker／SSH／無瀏覽器輸入面）。流程進度以 `method`、`authUrl`／`verificationUri`／`userCode` 暴露在狀態裡：pending 態的 UI 必須呈現可點的登入連結或設備碼——瀏覽器未自動打開（被攔截、遠端守護進程的 Web 管理）時這是唯一入口。取消端點（`POST /localapi/v0/account/cancel`）中止進行中的流程並復位 signed_out；守護進程在流程 pending 時拒絕重啟，UI 切換登入方式必須先取消。登入產生的訂閱在三端一致：`type=xbond`、`accountIssuer`、`kind=cloud`（桌面與移動都經 `BindAccount`）；粘貼 token 手動建立的 xbond 訂閱不帶 issuer，歸普通訂閱語義。

### 概覽讀取

守護進程以保存的 OAuth 會話（自動刷新、旋轉令牌回寫）對 Cloud 發一次 tRPC 批量讀取：身份 `user.profile.me`、服務狀態 `user.billing.subscription`、公告 `user.notifications.list`。身份是權威讀取：UNAUTHORIZED 觸發一次強制刷新重試，仍失敗則整體報錯。服務與公告讀取各自退化——讀取失敗只讓對應部分缺失（空列表與讀取失敗以 nil／空區分），不阻斷身份展示，退化以 `overviewError` 呈現。令牌集合永不離開守護進程；LocalAPI 消費者只看到 `AccountState`。

### 緩存與展示

最近一次成功的概覽以 0600 緩存於數據目錄（account-overview.json），守護進程啟動時立即展示緩存並在後台刷新；刷新失敗保留緩存並上報 `overviewError`。控制台入口由會話自身的 origin 推導（`{origin}/dash`）——是簽發令牌的發行方，不是用戶輸入。登錄成功後、狀態翻轉為 signed_in 之前完成首次同步；刷新（resync）同樣同步刷新概覽。登出時遞增同步代數，遲到的後台同步不得復原已重置的狀態。

### 服務狀態語義

「已登入而無服務」可判定：billing 關閉收縮為 `plan: "free"`、`enabled: false`；`quotaState: "blocked"` 表示流量用盡；`servicePeriodEnd` 為空或過去表示到期。客戶端只展示狀態與跳轉控制台，不自動替換普通（第三方）配置，也不在客戶端內購買。

### 登出與緩存清理

登出按 RFC 7009 對刷新令牌調用發行方的 revocation 端點（盡力而為：網絡失敗不阻止本地登出），隨後刪除會話文件、概覽緩存與賬號綁定的訂閱（`type=xbond` 且帶 `accountIssuer`）；手動導入的訂閱（含粘貼 token 的 xbond 訂閱）保留。遠端會話的剩餘授權（PKCE sid 綁定的瀏覽器會話）由控制台管理，客戶端登出不等於遠端全面吊銷。

## 驗收條件

| 編號 | 結果 | 驗證入口 |
| --- | --- | --- |
| ACCOUNT-01a | 概覽批量讀取三過程、身份 401 映射刷新重試、服務／公告讀取獨立退化且空列表不等於失敗 | `internal/clientapi` 測試 |
| ACCOUNT-01b | 概覽同步折入狀態（身份、服務、控制台連結）、旋轉令牌回寫會話、緩存落盤 | `internal/account`、`internal/daemon` 測試 |
| ACCOUNT-01c | 登出撤銷刷新令牌（盡力而為）、刪除會話與概覽緩存、遲到同步不復原狀態 | 同上 |
| ACCOUNT-01d | 啟動展示緩存概覽，Cloud 失敗保留緩存並上報 overviewError | `internal/daemon` 測試 |
| ACCOUNT-01e | Cloud 側 `user.profile.me` 為 Bearer 可讀身份出口，路由快照釘住 | cloud `client-oauth.test.ts`、`routes.snapshot.test.ts` |
| ACCOUNT-02 | 瀏覽器 PKCE 登入全鏈路可用（會話授權 → 回環回跳 → 令牌 → 鏈路發現 → 訂閱綁定），pending 態呈現登入連結／設備碼，取消後可換方式重啟 | 真實鏈路冒煙（dev Cloud + 守護進程，簽入到 signed_in 並綁定訂閱）、`internal/daemon` 取消重啟測試、cloud `client-oauth.test.ts` PKCE 分支 |

## 已知限制

通知為輪讀，無推送通道；已讀標記（markRead 族）本切片未接入客戶端。緩存寫入失敗只損失啟動時的新鮮度，不作為錯誤上報。控制台入口假設 dash 掛在發行方 origin 的 `/dash` 路徑。測試使用 tRPC 批量替身，不證明真實 Cloud 部署、配額數值或公告內容的正確性。瀏覽器登入已對 dev Cloud 部署全鏈路實測（含回環隨機端口回跳與訂閱綁定），對生產部署僅要求種子行在位。
