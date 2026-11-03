---
name: XBond 用戶端設計系統
description: 以日常連線為中心的跨端玻璃浮島設計，適用桌面、流動 App、Web 與瀏覽器擴充功能。
colors:
  brand: "oklch(0.7163 0.1706 53.45)"
  brand-strong: "oklch(0.66 0.18 52)"
  brand-foreground: "oklch(0.985 0 0)"
  brand-text: "oklch(0.55 0.15 45)"
  brand-text-dark: "oklch(0.78 0.13 58)"
  background: "oklch(0.975 0 0)"
  background-dark: "oklch(0.145 0 0)"
  foreground: "oklch(0.145 0 0)"
  foreground-dark: "oklch(0.985 0 0)"
  card: "oklch(1 0 0)"
  card-dark: "oklch(0.185 0.004 55)"
  popover: "oklch(1 0 0)"
  popover-dark: "oklch(0.22 0.005 55)"
  surface-inset: "oklch(0.955 0 0)"
  surface-inset-dark: "oklch(0.115 0.003 55)"
  muted-foreground: "oklch(0.5 0 0)"
  muted-foreground-dark: "oklch(0.72 0 0)"
  border: "oklch(0.915 0 0)"
  border-dark: "oklch(1 0 0 / 8%)"
  border-strong: "oklch(0.86 0 0)"
  border-strong-dark: "oklch(1 0 0 / 14%)"
  sidebar: "oklch(1 0 0)"
  sidebar-dark: "oklch(0.16 0.004 55)"
  sidebar-foreground: "oklch(0.22 0.005 55)"
  sidebar-foreground-dark: "oklch(0.93 0 0)"
  success: "oklch(0.54 0.16 153)"
  success-dark: "oklch(0.72 0.16 150)"
  success-text: "oklch(0.489 0.116 156.7)"
  warning: "oklch(0.78 0.16 85)"
  warning-dark: "oklch(0.8 0.16 85)"
  warning-text: "oklch(0.52 0.125 72)"
  info: "oklch(0.53 0.16 247)"
  info-dark: "oklch(0.72 0.15 245)"
  destructive: "oklch(0.57 0.22 26)"
  destructive-dark: "oklch(0.7 0.2 25)"
  destructive-text: "oklch(0.523 0.203 26.4)"
typography:
  title:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  headline:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.25
  subtitle:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  body-touch:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
  code:
    fontFamily: "ui-monospace, Cascadia Code, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "0.75rem"
  card: "1.5rem"
  rail: "1.75rem"
  pill: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  gap: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.card}"
    rounded: "{rounded.control}"
    padding: "0.5rem 1rem"
  button-brand:
    backgroundColor: "{colors.brand-foreground}"
    textColor: "{colors.brand}"
    rounded: "{rounded.control}"
    padding: "0.5rem 1rem"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "0.5rem 1rem"
  button-brand-dark:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-foreground}"
    rounded: "{rounded.control}"
    padding: "0.5rem 1rem"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "{spacing.lg}"
  input:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.75rem"
  nav-item-active:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "0.625rem 0.75rem"
---

# XBond 設計系統

<!-- impeccable:design-schema 1 -->

## Overview

**設計核心：「隨身連線，玻璃浮島」。**

XBond 是日常連線工具。介面先讓用戶理解目前狀態、影響範圍與所用節點，再完成啟停、換節點或恢復；完整配置、策略、記錄及診斷留在專責工作區。白灰卡片、磨砂玻璃、大圓角與柔和陰影提供親和且清楚的層次，品牌橙只強調主要行動及必要狀態。

本文記錄已確認的跨端設計基準。頁首令牌中的品牌及語義配色沿用既有系統，更新的形狀、字級與響應式規則是實施目標；規範更新不代表相關介面已全部完成或通過平台及視覺驗收。逐頁內容、互動、狀態及驗收見[跨端體驗設計](docs/design/client-experience-proposal.md)，實際產品能力以 [PRODUCT.md](PRODUCT.md) 及行為規格為準。

### 原生客戶端視覺基準

以用戶指定的[桌面參考](docs/design/references/native-desktop.png)及[手機參考](docs/design/references/native-mobile.png)作為視覺依據：乳白磨砂表面、柔和向下陰影、圓潤連線主操作、清楚的狀態層級與懸浮導覽。參考圖是概念示意，圖片中的示例數據、標誌變體及手機「系統代理」文案不構成功能或品牌變更。

- **主次**：連線主卡是首頁重心；桌面右側承接節點與偏好，手機按任務單欄排列。保留有用留白，不把所有狀態壓成等權橫條或 KPI 方塊。
- **觸感**：圓形連線鍵具克制的內高光、邊緣及按壓回應；卡片、分段滑塊與開關共享柔和幾何，不使用高亮塑膠或重複發光邊框。
- **閱讀**：文字在穩定乳白／石墨表面上，層級由字重、間距及位置建立，不靠大量眉題、技術識別碼和邊框製造儀表感。
- **導航**：桌面獨立玻璃側欄，手機底部留距的玻璃浮島；系統安全區、返回、鍵盤、視窗及 VPN 授權遵從宿主慣例。
- **操作**：啟停、換節點和模式可就近完成，載入和錯誤留在相關位置；原生感同時包含回應與恢復，不能只靠大圓角和模糊。

B 方案保留為內容分組與操作效率的參考；上述圖片及規則是較新的視覺基準，優先於此前的緊湊橫條構圖。這是設計決定，尚須以實作和原生宿主結果驗證。

**主要特徵：**

- 日常連線優先，首頁只有一個清楚的主操作和適量高頻資訊。
- 玻璃用於導覽與浮層，工作卡維持穩定可讀的乳白表面。
- 緊湊、標準、寬屏三檔，檔內自然重排，避免過度拆分。
- 桌面八入口、手機四主入口，擴充功能另有快捷面板與完整管理頁。
- 操作有原位回應，失敗保留可用狀態；核心、接管及出口分別表達。

## Colors

品牌橙沿用現有標誌；中性灰畫布、潔淨白色工作面及石墨深色表面承擔主要閱讀。色值以頁首令牌為準，不因加入玻璃而重建另一套品牌配色。

樣式實現層是 Tailwind CSS v4 + shadcn/ui：令牌單一來源在 `packages/client-ui/src/styles/tokens.css`，工具類經 `styles/index.css` 的 `@theme inline` 映射生成，組件原語在 `packages/client-ui/src/components/ui/`。狀態與表面只走語義令牌工具類（`bg-card`、`text-success-text` 等），一律不寫原始色板類（`bg-emerald-500` 之類），深淺色因此保持同構。

| 角色 | 令牌 | 用途 |
| --- | --- | --- |
| 品牌 | `brand`、`brand-strong`、`brand-text` | 連線主操作、選中、焦點及少量品牌標記 |
| 工作表面 | `background`、`card`、`popover`、`surface-inset` | 畫布、任務卡、浮層與控制軌道 |
| 文字與邊界 | `foreground`、`muted-foreground`、`border`、`border-strong` | 正文、補充說明與可操作輪廓 |
| 狀態 | `success`、`warning`、`info`、`destructive` 及相應文字色 | 已知成功、注意、處理中與錯誤，不用顏色代替事實 |

圓形連線主操作可使用品牌橙表面及深色電源符號，保留可辨認的輪廓與按壓回應。一般品牌按鈕保留明暗構圖：淺色近黑底配品牌橙，深色橙底配深色字；亮橙底不配白字。狀態文字採對應文字級色，主要文字至少 4.5:1，大字及必要功能圖形至少 3:1，透明表面須按最不利背景驗證。

## Typography

共享介面沿用自託管 Inter Variable 與系統中文字體。桌面正文及操作使用 `body`，手機主要閱讀及輸入使用 `body-touch`；原生文字依宿主的字體縮放與文字角色處理。必要頁名使用 `title`，卡片標題使用 `subtitle`，連線主狀態使用 `headline`，技術資料使用 `code`。

首頁不為填滿版面放大字或重複頁名。輔助文字不能承擔唯一操作或重要錯誤；大字、長名稱與多語文案可令行高及卡片自然增加。中文不加裝飾字距，數據使用等寬數字並附單位，網址與技術字串保留完整查看或複製方式。

繁體中文採香港用語：用戶、流動裝置、網絡、設定、匯入、複製、載入、儲存、連線及伺服器。支援既有語系和 RTL，位址及協定依需要保持 LTR，不靠固定左右定位排版。

## Layout

### 任務、導覽與頁頭

一張卡處理一項任務，一張設定卡可包含多個同類設定行；列表項不各自套大卡，避免卡片層層相套。工作卡直接浮於畫布，不強制先把整個內容區包進一張巨卡。相鄰任務使用共享間距，同一任務內保持緊湊。

桌面及完整 Web 保留「首頁、節點、訂閱、連線、規則、日誌、診斷、設定」八入口。標準及寬屏使用完整側欄，緊湊時使用八入口抽屜；不增加獨立圖示軌道檔。控制目標在側欄上方或緊湊頂列常駐，Cloud 帳號另有入口；目標、配置與身份不混成一個選擇器。

手機保留「首頁、節點、活動、設定」四項底部導覽。訂閱從首頁配置摘要及設定進入，連線與日誌在活動內，規則及診斷有清楚次級入口。八入口及四入口由宿主決定，不由窗口寬度互相切換。

首頁移除重複的大頁名與介紹段，直接開始連線任務。列表及設定頁保留緊湊頁名、搜尋及唯一主操作；說明就近放在相關區域。側欄不常駐堆疊 PID、版本和持續跳動的多項指標。

內容分組沿用已選的 B 方案；視覺以用戶確認的桌面／手機參考圖為準：圓形連線鍵、清楚的連線主卡、右側節點及偏好、玻璃側欄與手機浮島底欄。原生感及操作主次優先於將所有資訊壓成橫條。

### 三檔響應式

| 版面 | 可用 CSS 寬度起點 | 結構 |
| --- | --- | --- |
| 緊湊 | 小於 768px | 單欄、主操作優先；詳情單獨打開，導覽按宿主收斂 |
| 標準 | 768–1439px | 側欄＋主要內容，以 960 × 720 客戶端校準；首頁連線主卡與輔助區，詳情按需打開 |
| 寬屏 | 1440px 及以上 | 列表及已選詳情可同屏；首頁保持任務流，模式與配置可並列 |

只有兩處主要結構切換，檔內用彈性欄寬與自然換行，不為每張卡列額外閾值。標準檔較窄時，首頁主卡與輔助區可疊放；2K／4K 共用寬屏一檔，不等比例放大字體及控制項。表單按閱讀需要限寬，資料列表和詳情可用更多空間，不把整個產品封在同一最大寬度內。

主內容按「連線 → 當前節點 → 常用模式 → 配置與用量」排列。首頁不放全量策略清單、訂閱匯入表單、局域網／端口輸入或日誌。必要的核心、接管、出口事實直接可見，次要技術資料進專責頁或詳情。

### 視口與操作連續性

安全區只預留一次，軟鍵盤出現後欄位、錯誤及提交仍可見；低高度先減少裝飾留白，再正常捲動。一般頁面保留一個主要縱向捲動區，表格橫向捲動限制在自身區域。

詳情由並列轉抽屜或全屏時，保留草稿、焦點、搜尋、選中與捲動位置；不重連、不重送操作。Web 操作區至少 44 × 44 CSS px，原生 iOS／Android 分別按 44pt／48dp 校驗。觸控、鍵盤、縮放及大字不能依賴 Hover 或縮小控制項解決。

擴充功能彈出視窗始終為快捷面板：代理開關、節點、模式與必要網站／配額摘要，只有一個捲動區；長任務進完整管理頁並帶入目的地。完整管理頁的八入口為首頁、節點、帳號、規則、請求、日誌、診斷、設定，依瀏覽器能力呈現，不冒充原生核心。

## Elevation & Depth

玻璃負責導覽、底欄及浮層的空間層級，工作卡維持高不透明度或實色閱讀面。以共享表面色衍生透明度，不逐頁硬編另一套白色／黑色玻璃；深色使用石墨階梯、微亮邊界及內高光，避免霓虹邊緣。

| 表面 | 材質目標 | 深度 |
| --- | --- | --- |
| 導覽／浮層 | 約 82% 表面不透明度、20px 背景模糊 | 微弱內高光、細輪廓與柔和向下陰影 |
| 工作卡 | 實色或約 96% 表面不透明度 | 輕描邊及低濃度向下陰影，保持文字穩定 |
| 凹面控制 | `surface-inset` 軌道或輸入面 | 選中滑塊回到清楚的工作表面 |

陰影、材質及過渡的機器可讀值記錄於 `.impeccable/design.json`，屬已確認設計目標。背景模糊不支援、減少透明度或效能不足時用實色回退；不為每列或每個子控制建立模糊層，也不讓模糊常駐動畫。

## Shapes

形狀由控制項、任務卡到浮島逐級柔化：`rounded.control` 為 12px、`rounded.card` 為 24px、`rounded.rail` 為 28px，開關及小徽章使用完整膠囊形。這些是本次更新的目標尺度，現有樣式尚需同步；不以舊半徑當作已完成新版的證據。

圓形用於連線主操作和必要狀態圖形，一般次要按鈕不全做藥丸。圖示使用一致的線條、尺寸及可存取名稱；供應者名稱可保留原文，功能圖示不以 emoji 代替。

## Components

### 控制項與設定行

按鈕、輸入、分段及開關共用預設、懸停、焦點、按壓、停用、待處理和錯誤語言。每區只有一個明確主操作；網址、識別碼及命令有標籤和完整值，錯誤緊跟欄位，不只依賴 Placeholder 或 Toast。

開關視覺軌道約 44 × 26px，白色圓形滑塊，開啟可用品牌橙配深色功能標記；觸控區仍符合宿主下限。設定行先標籤及解釋，再控制項，空間不足時換行；偏好可直接生效，端口等輸入有驗證及明確儲存回應。

### 狀態與操作回應

未知、載入中、未啟用、進行中、成功、部分完成、失敗及資料過期分別呈現。核心運行、流量接管、出口驗證、帳號登入與配置有效性是不同事實；遠端管理不能顯示本機 VPN／TUN 已啟用。

啟停、切節點及改模式顯示原位進度，成功才改變選中；失敗保留原選擇及恢復入口。部分完成需說明已完成哪一步；尺寸變化或面板關閉不代表取消後端操作。複製在原處顯示「已複製」，失敗保留文字供手動選取。

### 配置、配額與流量

使用中配置優先，完整管理屬訂閱頁；匯入完成表示配置已加入，不代表已啟動代理。配額同時有數值、總額及資料來源，未知、無總額、載入失敗、零餘額與超額分開；配額圖形不能取代文字，也不強制在首頁畫環。

即時速率、核心累計與訂閱配額分別命名，到期日與重設日分開。只有真實樣本才畫走勢，失聯標明停止更新，不持續補假樣本。節點延遲附量度口徑，切換保持策略組上下文，不宣稱所有流量共用同一出口。

### 動畫與回饋

動畫只交代按壓、選中、面板及真實狀態，沿用無超調緩動。按壓約 120ms、滑塊約 160ms、面板約 200ms；必要的低幅運行光環可用 2.4s，並非安全或連通證明。減少動態時取消循環、旋轉及位移，以靜態文字保留資訊。

回應以控制項原位為先，其次欄位／區塊、頁面狀態列，再用短提示。需行動的錯誤保留至處理，來源失聯不反覆彈通知；已有資料不整頁清空換骨架，沒有真實進度不畫百分比。背景及離屏的圖表停止不必要繪製。

### 擴充功能差異

目前擴充功能要求 XBond 帳號與專用配置，不提供桌面的通用訂閱匯入。其「關閉」或 `direct` 模式是釋放本擴充功能設定，文案為「跟隨瀏覽器設定」而非「全裝置直連」。代理控制權被政策或其他擴充功能取得時明確說明，不自動搶回；請求記錄、規則預測與原生核心連線分開命名。

## Do's and Don'ts

### Do

- 優先呈現日常連線、目前節點、影響範圍和可處理的狀態。
- 保留桌面八入口、手機四主入口，使用緊湊、標準、寬屏三檔適配。
- 玻璃外殼與可讀工作面分工，明暗、減少動態及實色回退保持同一層級。
- 讓詳情、草稿及操作狀態跨尺寸連續，重要回應就近可見。

### Don't

- 不用大面積橙色、橙底白字、層層卡片或常駐動畫增加閱讀負擔。
- 不把 2K／4K 當作放大版手機，也不為每個尺寸和元件建立新檔位。
- 不用綠點、光環、帳號登入或配置加入代替真實接管與連通結果。
- 不把設計規範、文件更新或 mock 當作已實作和原生平台驗證。
