---
name: XBond 用戶端設計系統
description: 原生為先、信號為輔的跨端設計，適用桌面、流動 App、Web 與瀏覽器擴充功能。
colors:
  brand: "oklch(0.716 0.171 53.4)"
  brand-strong: "oklch(0.66 0.18 52)"
  brand-foreground: "oklch(0.19 0.006 60)"
  brand-text: "oklch(0.5 0.145 45)"
  brand-soft: "oklch(0.935 0.045 68)"
  background: "oklch(0.973 0.004 70)"
  background-dark: "oklch(0.155 0.006 60)"
  foreground: "oklch(0.19 0.008 60)"
  foreground-dark: "oklch(0.955 0.004 70)"
  card: "oklch(1 0 0)"
  card-dark: "oklch(0.225 0.007 60)"
  popover: "oklch(1 0 0)"
  popover-dark: "oklch(0.255 0.008 60)"
  surface-inset: "oklch(0.945 0.005 70)"
  surface-inset-dark: "oklch(0.128 0.006 60)"
  muted-foreground: "oklch(0.44 0.008 60)"
  muted-foreground-dark: "oklch(0.75 0.008 65)"
  border: "oklch(0.85 0.006 70)"
  border-dark: "oklch(1 0 0 / 17%)"
  border-strong: "oklch(0.76 0.009 70)"
  border-strong-dark: "oklch(1 0 0 / 25%)"
  sidebar: "oklch(0.943 0.007 70)"
  sidebar-dark: "oklch(0.19 0.007 60)"
  success: "oklch(0.55 0.135 155)"
  success-text: "oklch(0.45 0.115 156)"
  warning: "oklch(0.79 0.15 85)"
  warning-text: "oklch(0.49 0.115 70)"
  info: "oklch(0.54 0.15 247)"
  destructive: "oklch(0.56 0.2 27)"
  destructive-text: "oklch(0.49 0.18 27)"
typography:
  display:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
  subtitle:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  body-touch:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.35
  code:
    fontFamily: "ui-monospace, Cascadia Code, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "0.375rem"
  card: "0.625rem"
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
    height: "2rem"
  button-brand:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-foreground}"
    rounded: "{rounded.control}"
    height: "2rem"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "1.25rem"
  input:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: "2rem"
  nav-item-active:
    backgroundColor: "{colors.brand-soft}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: "2.25rem"
---

# XBond 設計系統

<!-- impeccable:design-schema 1 -->

## Overview

**設計核心：「原生信號台」。**

XBond 是每天都會打開的連線工具。介面先回答三件事：現在通不通、流量走哪裡、下一步能做甚麼。外觀像所在平台的原生應用，資訊編排像一台安靜的儀表：暖紙色畫布、石墨文字、實色工作面、髮絲分隔，品牌橙只留給連線主操作、選中與焦點。

這不是把每個平台畫成不同產品。跨端共享同一套語義令牌、用語與能力含義；宿主只決定形狀、字體、材質與導覽慣例。首頁內容維持連線、當前節點、常用模式、配置與用量，逐頁互動見[跨端體驗設計](docs/design/client-experience-proposal.md)，產品能力以 [PRODUCT.md](PRODUCT.md) 為準。

### 四條原則

1. **先講事實，再談裝飾。** 核心運行、流量接管、出口驗證分開表達；未知就是未知，不以顏色、綠點或動畫代替結果。
2. **一個畫面只有一個重心。** 首頁重心是連線主操作；設定頁重心是當前分組；列表頁重心是資料本身。次要資訊靠字重、間距與位置退後，不靠再加一層卡。
3. **形狀跟隨宿主。** 控件高度、圓角、焦點、開關與選單按 macOS／Windows／iOS／Android／Web 各自的比例；令牌一處定義，不在頁面內寫死。
4. **材質只用系統給的。** macOS vibrancy、Windows Mica、iOS 材質由原生殼提供；Web 一律實色，不用 `backdrop-filter` 模擬磨砂。

### 宿主基準

| 宿主 | 導覽 | 控件圓角 | 卡片圓角 | 字體 |
| --- | --- | --- | --- | --- |
| macOS | 左側 source list 側欄 | 6px | 10px | `-apple-system`（SF） |
| Windows 11 | 左側導覽欄，選中帶左軌 | 4px | 8px | `Segoe UI Variable` |
| iOS | 底部標籤欄、分組列表 | 8px | 12px | `-apple-system`（SF） |
| Android | 底部導覽、Material 3 | 10px | 12px | `Roboto`／系統字體 |
| Web | 與桌面同構，跟隨瀏覽器主題 | 6px | 10px | `system-ui` |

根節點的 `data-host` 由 `platform/host.ts` 在渲染前寫入；令牌在 `styles/tokens.css` 按宿主覆寫。

## Colors

令牌單一來源是 `packages/client-ui/src/styles/tokens.css`，工具類經 `styles/app.css` 的 `@theme inline` 映射。元件只使用語義工具類（`bg-card`、`text-success-text` 等），不寫原始色板類（`bg-emerald-500` 之類）。

| 角色 | 令牌 | 用途 |
| --- | --- | --- |
| 品牌 | `brand`、`brand-strong`、`brand-text`、`brand-soft` | 連線主操作、選中、焦點、少量品牌標記 |
| 工作面 | `background`、`card`、`popover`、`surface-inset` | 畫布、任務面、浮層、凹面軌道 |
| 文字與邊界 | `foreground`、`muted-foreground`、`border`、`border-strong` | 正文、補充說明、分組與可操作輪廓 |
| 狀態 | `success`、`warning`、`info`、`destructive` 及相應文字色 | 已知成功、注意、處理中、錯誤 |

- 品牌橙是強調色，不是背景色。大面積橙底、橙底白字、常駐光暈都不用。
- 橙面上的文字與圖示固定用深墨 `brand-foreground`；亮橙不配白字。
- 主要文字至少 4.5:1，大字及必要功能圖形至少 3:1；半透明表面按最不利背景驗證。
- 深淺色同構：新增語義令牌時同時補 `:root` 與 `.dark`，不讓頁面自行判斷主題。

## Typography

共享介面使用各宿主系統字體，跟隨系統字體縮放。桌面正文用 `body`（14px），手機主要閱讀與輸入用 `body-touch`（16px）；頁面標題用 `title`，區塊標題用 `subtitle`，連線主狀態用 `display`，技術資料與數字用 `code` 或 `tabular-nums`。

- 中文不加裝飾字距；大標題才用負字距，正文保持正常。
- 數字附單位，速率與配額用等寬數字；網址、識別碼與命令保留完整查看或複製方式。
- 11px 只用於標籤、單位與輔助計量，不承擔唯一操作或重要錯誤。
- 首頁不重複大頁名，也不為填滿版面放大字。

## Layout

### 外殼

桌面及完整 Web 是全幅工作面：左側 240px 導覽軌，右側內容直接鋪在畫布上，兩者以髮絲邊分界，不再把內容包進一張懸浮大圓角卡。導覽分三組：日常（首頁、代理、配置）、排查（連線、規則、日誌、診斷）、底部設定與控制目標。控制目標、設備配置與 Cloud 身份收進側欄底部單一入口，分區呈現，不混成互斥選擇器。

手機保留「首頁、節點、活動、配置」四項底部導覽，設定由頁頭齒輪進入；連線與日誌在活動內，規則及診斷有清楚次級入口。八入口及四入口由宿主決定，不由窗口寬度互相切換。

### 頁面

- 頁面邊距 24px；手機 16px。區塊間距 20px；卡片內距 16–20px。
- 一張卡處理一項任務；同類設定行共用一張卡，不逐行套卡。
- 頁頭保留緊湊頁名、搜尋及唯一主操作；說明就近放在相關區域。
- 首頁依「連線 → 當前節點 → 常用模式 → 配置與用量」排列，不放全量策略清單、匯入表單或日誌。
- 表單按閱讀需要限寬；資料列表與詳情可用更多空間，不把整個產品鎖在同一最大寬度。
- 一般頁面只有一個主要縱向捲動區；表格橫向捲動限制在自身區域。

### 三檔響應式

| 版面 | 可用 CSS 寬度 | 結構                                           |
| ---- | ------------- | ---------------------------------------------- |
| 緊湊 | < 768px       | 單欄、主操作優先；詳情單獨打開；底部導覽       |
| 標準 | 768–1439px    | 側欄＋主內容；首頁主卡與右側輔助區             |
| 寬屏 | ≥ 1440px      | 列表與詳情可同屏；首頁保持任務流，資料區可並列 |

只有兩處主要結構切換；檔內用彈性欄寬與自然換行，不為每張卡列額外閾值。2K／4K 共用寬屏檔，不等比例放大字體與控件。

### 視口與操作連續性

安全區只預留一次；軟鍵盤出現後欄位、錯誤及提交仍可見。低高度先減少裝飾留白，再正常捲動。詳情由並列轉抽屜或全屏時，保留草稿、焦點、搜尋、選中與捲動位置。Web 操作區至少 44 × 44 CSS px；iOS／Android 分別按 44pt／48dp 校驗。

## Elevation & Depth

層級用分組背景、髮絲邊與明度差表達。陰影只給脫離文檔流的浮層。

| 表面 | 目標 | 深度 |
| --- | --- | --- |
| 畫布 | 實色 `background` | 無 |
| 卡片／分組 | 實色 `card`，與畫布有清楚明度差 | 1px `border`，無陰影 |
| 凹面控制 | `surface-inset` 軌道或輸入面 | 選中滑塊回到 `card` |
| 浮層（選單、對話框） | 實色 `popover` | 一套共享 `--elevation-raised`；深色改為微亮邊界 |
| 系統材質 | 僅宿主原生提供時 | 不可用或減少透明度時回退實色 |

不為每列或每個子控制建立模糊層，也不讓材質做常駐動畫。

## Shapes

- `rounded-control`：按鈕、輸入、分段、選單行、小頭像。
- `rounded-card`：卡片、面板、對話框、浮層。
- `rounded-full`：只給開關、狀態點、必要膠囊與圓形連線鍵。
- 原有 `rounded-sm/md/lg/xl/2xl` 已映射到同一尺度；新程式碼用語義名，不以舊類名當作已完成新版的證據。
- 圖示使用一致的線條與尺寸；功能圖示不用 emoji 代替。

## Components

### 按鈕

| 變體          | 用途                     | 外觀                       |
| ------------- | ------------------------ | -------------------------- |
| `default`     | 一般主操作               | 石墨底、紙白字             |
| `brand`       | 連線、保存帳號等品牌時刻 | 品牌橙底、深墨字，無陰影   |
| `outline`     | 次要操作                 | 卡片底、`border-strong` 邊 |
| `secondary`   | 低強調操作               | 凹面色底                   |
| `ghost`       | 工具列與行內操作         | 透明底，懸停才出現底色     |
| `destructive` | 刪除、中斷               | 紅底、白字                 |

高度：預設 32px、`sm` 28px、`lg` 36px；手機主要操作至少 44px。焦點用 2px 品牌外框加 3px 低透明度內環，不靠陰影表示焦點。

### 輸入與設定行

輸入框 32px 高、`rounded-control`、`surface-inset` 底、`border-strong` 邊；聚焦時邊框轉品牌色並加低透明度內環。標籤在控制項上方，錯誤緊跟欄位；不只用 Placeholder 或 Toast 表達錯誤。

設定行先標籤與解釋，再控制項；空間不足時換行。開關視覺軌道約 44 × 26px，白色滑塊，開啟用品牌橙配深墨勾選；觸控區仍符合宿主下限。切換內容用 Tabs，切換設定值用分段選擇；分段選中採卡片底加品牌文字，不整塊鋪橙。

### 卡片與面板

卡片是任務容器，不是裝飾。預設無陰影，靠 `border` 與畫布分開；卡內用髮絲線分段，不套子卡。只有浮層、拖拽中的物件與需要脫離文檔流的元素才加陰影。

### 狀態與操作回應

- 未知、載入中、未啟用、進行中、成功、部分完成、失敗、資料過期分別呈現。
- 核心運行、流量接管、出口驗證、帳號登入、配置有效性是不同事實，不能合併成一個「已連線」。
- 啟停、切節點與改模式顯示原位進度；成功才改變選中，失敗保留原選擇與恢復入口。
- 複製在原處顯示「已複製」，失敗保留文字供手動選取。
- 需行動的錯誤保留至處理；來源失聯不反覆彈通知。

### 配額與流量

配額同時有數值、總額與資料來源；未知、無總額、載入失敗、零餘額與超額分開。配額圖形不能取代文字。即時速率、核心累計與訂閱配額分別命名，到期日與重設日分開。只有真實樣本才畫走勢；失聯標明停止更新，不補假樣本。

### 動畫

動畫只交代按壓、選中、面板與真實狀態，沿用無超調緩動：按壓 120ms、滑塊 160ms、面板 200ms。減少動態時取消循環、旋轉與位移，以靜態文字保留資訊。背景及離屏圖表停止不必要繪製。

## Do's and Don'ts

### Do

- 先呈現日常連線、當前節點、影響範圍與可處理的狀態。
- 保留桌面八入口、手機四主入口，使用緊湊、標準、寬屏三檔。
- 跟隨宿主的控件、形狀、字體與導覽慣例；材質只用系統提供者。
- 讓詳情、草稿及操作狀態跨尺寸連續，重要回應就近可見。
- 用髮絲邊、分組與字重建立層級，讓畫面保持安靜。

### Don't

- 不用大面積橙色、橙底白字、層層卡片、常駐動畫或模擬磨砂。
- 不用統一大圓角覆蓋平台差異，也不為每個尺寸和元件建立新檔位。
- 不用綠點、光環、帳號登入或配置加入代替真實接管與連通結果。
- 不把 2K／4K 當作放大版手機。
- 不把設計規範、文件更新或 mock 當作已實作和原生平台驗證。

## 實作對照

| 層 | 位置 |
| --- | --- |
| 令牌 | `packages/client-ui/src/styles/tokens.css` |
| Tailwind 映射與全域樣式 | `packages/client-ui/src/styles/app.css` |
| 基礎原語 | `packages/client-ui/src/components/ui/` |
| 宿主形狀切換 | `packages/client-ui/src/platform/host.ts` + `tokens.css` 的 `[data-host]` |
| 應用外殼與導覽 | `packages/client-ui/src/app/app-shell.tsx`、`app/navigation/` |

新增或修改原語後，至少檢查桌面與手機寬度、明暗主題、鍵盤焦點、減少動態、長文案，以及載入／空／錯誤／成功狀態。Web 與 mock 截圖不能代替 macOS、Windows、iOS、Android 的實際平台驗收。

> AI生成
