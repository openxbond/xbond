# 用戶端設計文件與介面更新

分診：ready-for-agent

狀態：進行中

## 範圍

- **目標**：先建立可供後續實作依循的設計文件，沿用 cloud 控制台風格，統一繁體中文及香港用語。
- **設計依據**：[設計系統](../../DESIGN.md)、[產品定位](../../PRODUCT.md)；具體頁面組織保存在 `.impeccable/surfaces/web-src-containers-app-tsx.md`。
- **本次交付**：產品文件用語更新、設計令牌、元件規則、四項底部導覽及操作回應要求、設計預覽附檔。
- **後續實作**：卡片與留白、呼吸光環、配額環、流量羅盤、複製及匯入、平滑換節點。

## 切片與依賴

| 切片 | 名稱 | 依賴 | 狀態 | 涉及路徑 |
| --- | --- | --- | --- | --- |
| S1 | 完善設計文件及香港繁體中文用語 | 已確認的用戶要求、cloud 設計令牌 | 已完成 | `DESIGN.md`、`PRODUCT.md`、`.impeccable/design.json`、介面簡報 |
| S2 | 框架、卡片層次及四項底部導覽 | S1 | 待實作 | `web/src/containers/`、`web/src/styles/` |
| S3 | 連線狀態、配額環及流量羅盤 | S2、實際狀態及配額資料 | 待實作 | `web/src/containers/Connect/` |
| S4 | 複製、匯入及節點切換回應 | S2、平台與控制器能力 | 待實作 | `web/src/containers/Settings/`、`web/src/containers/Proxies/` |
| S5 | 桌面、手機、明暗主題及操作驗證 | S2 至 S4 | 待驗證 | 介面及相應測試 |

### 本次驗收條件

- AC-1：設計沿用 cloud 控制台的橙色、白色工作表面、中性層級與明暗主題；頁首令牌有實際來源。
- AC-2：手機常駐導覽固定為首頁、節點、活動、設定四項，訂閱與配置的入口明確。
- AC-3：呼吸光環、配額環及流量羅盤的資料含義、未知狀態與減少動態效果要求完整。
- AC-4：複製、匯入及換節點均有成功、處理中、失敗及恢復的表達要求。
- AC-5：本次文件的自然語言使用繁體中文及香港用語，技術名稱及資料格式欄位保留原名。
- AC-6：已確認的設計要求與已實作能力清楚區分，未經測試的介面不得視為已交付。

## 驗證證據

- `python -X utf8 .impeccable/update-design-document.py`：通過；36 項色彩令牌與目前樣式檔一致，產生 10 項元件參考，待實作元件有明確標示。
- `python -X utf8 .impeccable/check-design-document.py`：通過；核對文件章節、令牌參照、附檔結構、文件連結、常見簡繁用語及四項導覽的一致性。
- `pnpm exec oxfmt --check DESIGN.md PRODUCT.md docs/tasks/client-design-refresh.md .impeccable/design.json .impeccable/cloud-dash-direction.md .impeccable/surfaces/web-src-containers-app-tsx.md`：通過。
- `git diff --check -- DESIGN.md PRODUCT.md docs/tasks/client-design-refresh.md`：通過。

本次未執行應用程式測試、建置或視覺驗收，不以文件檢查代替介面驗證。

## 審查與探針

文件核對以 AC-1 至 AC-6 為範圍，均已對照文件確認：色彩有實際來源，四項導覽與訂閱入口一致，三項圖形元件的資料與動效含義完整，常用操作的回應要求明確，用語採香港繁體中文，設計目標與實作狀態分開記錄。元件參考不代表產品介面已交付。

本次沒有修改執行邏輯，不進行錯誤注入探針。

## 交付

文件更新日期：2026-10-28。

開始本次文件工作前，工作目錄已留有上一階段的未完成介面改動：包括五項導覽、訂閱路由、連線區塊及新色彩令牌。這些改動未完成樣式、建置或操作驗證，不能作為設計交付；後續 S2 必須按本次確認的四項底部導覽調整，再一併驗證。本次只更新文件，不繼續修改或撤銷這些程式碼。
