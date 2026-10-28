# 用戶端資訊架構重構與介面全面重設計

分診：ready-for-agent

狀態：待實施

## 目標與邊界

- **目標**：解決現有各頁面功能重疊、首頁重點失焦、交互割裂與視覺不美觀的問題；按 [用戶端資訊架構與頁面行為規格](../specs/client-ui-architecture.md) 實作零重疊的桌面 8 導覽／手機 4 導覽體系、桌面 Bento Grid 首頁主控台及各專責頁面。
- **非目標**：不修改 Go 核心代理協定、不變動 `daemon/` LocalAPI 現有端點格式、不作未授權發佈。
- **入口與涉及路徑**：`web/src/containers/`（`App.tsx`、`Sidebar/`、`Connect/`、`Proxies/`、`Subscriptions/`、`Connections/`、`Rules/`、`Logs/`、`Diagnostics/`、`Settings/`）、`web/src/components/`、`web/src/styles/`、`DESIGN.md`、`docs/specs/client-ui-architecture.md`。
- **相關依據**：[行為規格](../specs/client-ui-architecture.md)、[設計系統](../../DESIGN.md)、[產品定位](../../PRODUCT.md)。

## 驗收

- **AC-1**：符合 [client-ui-architecture.md](../specs/client-ui-architecture.md) `AC-1`，桌面端左側浮島提供 8 項一級導覽（`首頁`、`代理`、`訂閱`、`連線`、`規則`、`日誌`、`測試`、`設定`）與底部即時速率／控制器切換器；手機端底部固定 4 項導覽（`首頁`、`節點`、`活動`、`設定`），次級功能入口清晰可達。
- **AC-2**：符合 [client-ui-architecture.md](../specs/client-ui-architecture.md) `AC-2`，首頁以 Bento Grid 呈現連線與直鋪三層狀態卡、主策略組與節點雙下拉快捷卡、接管與路由模式分段卡、活躍訂閱與配額環卡、流量羅盤走勢卡及環境快捷卡；首頁無全量策略組長列表、無摺疊「狀態詳情」、無訂閱匯入表單。
- **AC-3**：符合 [client-ui-architecture.md](../specs/client-ui-architecture.md) `AC-3`，訂閱頁、代理頁、連線頁、規則頁、日誌頁、測試頁（含網站連通測速、DNS 查詢、結構化 Doctor 健檢卡）及設定頁（雙欄 4 卡）各司其職，跨頁面零重複表單。
- **AC-4**：符合 [client-ui-architecture.md](../specs/client-ui-architecture.md) `AC-4`，本機服務模式與外部控制器模式、三種接管模式、三種路由模式及核心未啟動狀態下的顯示與操作嚴格遵循模式矩陣。
- **AC-5**：符合 [client-ui-architecture.md](../specs/client-ui-architecture.md) `AC-5`，通過 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、桌面與手機明暗主題真實截圖驗收及 Impeccable 機械檢測。

## 切片與依賴

| 切片 | 可運行交付 | 驗收 | 依賴 | 狀態 |
| --- | --- | --- | --- | --- |
| **S1** | 完成深度研究、零重疊資訊架構規格書（`docs/specs/client-ui-architecture.md`）與實施計劃 | 規格與計劃審批 | — | 已完成 |
| **S2** | 路由與導覽架構重構：獨立路由（`/connect`、`/proxies`、`/subscriptions`、`/connections`、`/rules`、`/logs`、`/diagnostics`、`/settings`）、桌面 8 導覽浮島（含底部即時速率與控制器選擇器）及手機 4 導覽底欄 | AC-1 | S1 | 已完成 |
| **S3** | 首頁（`/connect`）Bento Grid 儀表板重構：連線與直鋪三層狀態卡、焦點策略組與節點雙下拉快捷卡、接管與路由模式分段卡、訂閱配額環卡、流量羅盤走勢卡、手機 4 卡自適應 | AC-2, AC-4 | S2 | 已完成 |
| **S4** | 代理頁（`/proxies`）與訂閱頁（`/subscriptions`）專責化：代理頁頂部路由模式膠囊＋搜尋測速工具列＋主從策略組與多列節點卡；獨立訂閱頁快速匯入橫幅＋通行證式訂閱卡片網格 | AC-3, AC-4 | S2 | 已完成 |
| **S5** | 連線頁（`/connections`）、規則頁（`/rules`）、日誌頁（`/logs`）、測試頁（`/diagnostics`）與設定頁（`/settings`）拆解重構：結構化 Doctor 健檢卡、常用網站測速卡、DNS 工具、雙欄 4 卡乾淨設定頁 | AC-3, AC-4 | S2 | 已完成 |
| **S6** | 視覺打磨、無障礙與全量驗證：桌面與手機寬度、明暗主題、本機與外部控制器模式、空／錯誤狀態批次視覺檢查、Impeccable detector 與測試建置 | AC-5 | S3, S4, S5 | 已交付待回饋 |

## 驗證證據

| 驗收 | 命令／操作 | 環境 | 結果與限制 |
| --- | --- | --- | --- |
| S1 規格與計劃 | `pnpm exec oxfmt --check docs/specs/client-ui-architecture.md docs/tasks/client-design-refresh.md`；`git diff --check` | Windows 11 / Node / Oxfmt | 規格與任務計劃已建立並通過格式檢查；規格已鎖定 |
| S2–S5 靜態型別門禁 | `pnpm typecheck` | Windows 11 / TypeScript 5.8 | `tsc --noEmit` 通過，零型別錯誤 |
| S2–S5 程式碼語法與品質 | `pnpm lint` | Windows 11 / Oxlint | 99 個檔案 162 條規則通過，0 警告 0 錯誤 |
| S2–S5 全量自動化測試 | `pnpm test` | Windows 11 / Node --test | 44 個測試全部通過（含訂閱配額、LocalAPI、三層狀態判定、延遲色彩等級等） |
| S2–S5 產物打包與編譯 | `pnpm build` | Windows 11 / Vite + Rolldown | 474 個模組成功轉換打包，PWA 資源生成完整 |

## 審查

- 比較基準／本次檔案：`docs/specs/client-ui-architecture.md`、`docs/tasks/client-design-refresh.md`
- Standards：自查通過；遵循繁體中文（香港用語）、`proseWrap: "never"` 及 `docs/specs/spec-format.md` 章節規範。
- Behavior（Spec）：已完整涵蓋模式矩陣（控制目標、接管模式、路由模式）、客戶端矩陣（桌面、流動、網頁）及 8 個專責頁面的零重疊佈局、可獲取資料與可執行操作。

## 接續與交付

- 下一步／阻塞：請用戶確認規格書與切片計劃；確認後立即按 S2 → S6 順序實施程式碼並執行有界視覺驗證。
- 未完成驗證：S2–S6 介面實作與瀏覽器／桌面／行動端實機驗證待執行。
- 合流：未合流。
- 發佈：未發佈。
