---
name: XBond 用戶端設計系統
description: Bento Grid 2.0 風格的跨端設計：極光畫布、磨砂玻璃模組、柔和陰影與細膩漸變。
colors:
  brand: "oklch(0.7 0.19 45)"
  brand-strong: "oklch(0.62 0.21 35)"
  brand-foreground: "oklch(0.18 0.02 40)"
  brand-action: "oklch(0.53 0.18 43)"
  brand-action-foreground: "oklch(0.99 0 0)"
  brand-text: "oklch(0.52 0.17 40)"
  brand-soft: "oklch(0.94 0.045 55)"
  accent-mint: "oklch(0.7 0.13 172)"
  accent-mint-text: "oklch(0.42 0.1 175)"
  accent-blue: "oklch(0.64 0.15 255)"
  accent-blue-text: "oklch(0.48 0.14 258)"
  accent-violet: "oklch(0.68 0.13 300)"
  accent-violet-text: "oklch(0.5 0.13 300)"
  background: "oklch(0.962 0.008 255)"
  background-dark: "oklch(0.15 0.012 260)"
  foreground: "oklch(0.19 0.018 265)"
  foreground-dark: "oklch(0.96 0.006 255)"
  card: "oklch(1 0 0 / 84% 到 62%)"
  popover: "oklch(1 0 0 / 94%)"
  muted-foreground: "oklch(0.47 0.018 265)"
  muted-foreground-dark: "oklch(0.78 0.012 255)"
  border: "oklch(0.2 0.02 265 / 9%)"
  border-dark: "oklch(1 0 0 / 11%)"
  sidebar: "oklch(1 0 0 / 52%)"
  sidebar-dark: "oklch(0.21 0.016 260 / 58%)"
  success: "oklch(0.66 0.14 168)"
  warning: "oklch(0.8 0.15 85)"
  info: "oklch(0.62 0.15 250)"
  destructive: "oklch(0.57 0.2 25)"
typography:
  display:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.04em"
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
  control: "0.625rem"
  card: "1.25rem"
  hero: "1.5rem"
  pill: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  gap: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-brand:
    backgroundColor: "{colors.brand-action}"
    backgroundImage: "linear-gradient(135deg, oklch(0.54 0.18 43), oklch(0.49 0.17 35))"
    textColor: "{colors.brand-action-foreground}"
    rounded: "{rounded.control}"
    height: "2.125rem"
  button-primary:
    backgroundColor: "{colors.foreground}"
    textColor: "oklch(0.985 0 0)"
    rounded: "{rounded.control}"
    height: "2.125rem"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "1.25rem"
  input:
    backgroundColor: "color-mix(in oklab, var(--background) 54%, transparent)"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: "2.25rem"
  nav-item-active:
    backgroundColor: "oklch(1 0 0 / 45%)"
    textColor: "{colors.foreground}"
    rounded: "0.75rem"
    height: "2.5rem"
---

# XBond 設計系統

<!-- impeccable:design-schema 1 -->

## Overview

**設計核心：Bento Grid 2.0「有序的混亂」。**

XBond 的畫面是一張冷瓷色極光畫布，功能拆成一塊塊磨砂玻璃便當卡：尺寸不等、靠柔和陰影與髮絲光邊浮起。品牌橙是唯一強調色，負責連線主操作、選中與焦點；薄荷、藍、紫只出現在數據圖例和狀態語義裡，不鋪卡面。整體要輕、透、安靜，但每張卡都清楚自己是一個任務。

**UX 底線：一屏一件事、零學習成本、全狀態誠實反饋。**

- 一個畫面只有一個重心；首頁重心永遠是「現在通不通」。
- 主要操作永遠明顯；「如果媽媽第一次打開也能看懂」是驗收標準。
- 載入有微交互緩解等待；錯誤說清「哪裡錯、為甚麼、怎麼辦」；空狀態負責教育和促活。
- 觸控目標、行高、對比度按無障礜標準校驗，並照顧神經多樣性使用者的低刺激閱讀。

### 宿主基準

| 宿主 | 導覽 | 控件圓角 | 卡片圓角 | Hero 圓角 | 字體 |
| --- | --- | --- | --- | --- | --- |
| macOS | 浮動玻璃側欄 | 10px | 20px | 24px | `-apple-system`（SF） |
| Windows 11 | 浮動玻璃側欄 | 8px | 16px | 20px | `Segoe UI Variable` |
| iOS | 底部標籤欄 | 12px | 24px | 28px | `-apple-system`（SF） |
| Android | 底部導覽（M3） | 12px | 24px | 28px | `Roboto`／系統字體 |
| Web | 與桌面同構 | 10px | 20px | 24px | `system-ui` |

根節點 `data-host` 由 `platform/host.ts` 在渲染前寫入；令牌在 `styles/tokens.css` 按宿主覆寫形狀與字體。

## Colors & Aurora

令牌單一來源是 `packages/client-ui/src/styles/tokens.css`，工具類經 `styles/app.css` 的 `@theme inline` 映射；元件只用語義類，不用原始色板。

| 角色 | 令牌 | 用途 |
| --- | --- | --- |
| 極光 | `aurora-peach`、`aurora-slate` | 畫布後景，最多兩色、低透明、靜態不動 |
| 品牌 | `brand`、`brand-strong`、`brand-text`、`brand-soft` | 連線主操作、選中、焦點，唯一的漸變色 |
| 數據點綴 | `accent-mint`、`accent-blue`、`accent-violet` 及文字版 | 只用於圖例、狀態點與延遲色階，不鋪卡面 |
| 工作面 | `background`、`card`、`popover`、`surface-inset` | 畫布、玻璃卡、浮層、內凹面 |
| 文字與邊界 | `foreground`、`muted-foreground`、`border`、`border-strong` | 正文、補充說明、輪廓 |
| 狀態 | `success`、`warning`、`info`、`destructive` 及文字色 | 已知成功、注意、處理中、錯誤 |

- 主按鈕使用深橙色 `--gradient-brand` 和白色 `brand-action-foreground`；兩端顏色均保證正文對比度 ≥ 4.5:1。
- 極光最多兩色（暖橙＋冷灰藍）、低透明（≤18%），只出現在畫布與卡片縫隙，不壓文字。
- 深淺色同構：新增令牌必須同時補 `:root` 與 `.dark`。

## Glass Material & Elevation

| 表面 | 材質 | 深度 |
| --- | --- | --- |
| 畫布 | 實色 + 靜態極光層（`body::before`，不加 blur、不動畫） | 無 |
| Bento 卡 `.bento` | `--glass-surface` 半透漸變，不做背景採樣 | 內高光 + 外圈髮絲 + 柔影 |
| Hero 卡 `.bento-hero` | 中性玻璃疊一層品牌橙徑向光暈：待機 10%（右上）；核心實際運行時加 `.bento-hero-live`，右上增亮至 15% 並在左下補 8% 回聲，狀態即事實、不加動畫 | 環境色投影略強於普通卡 |
| 內凹面 `.bento-inset` | `--glass-inset` 漸變 | 內高光，用於卡內小模組 |
| 浮動導覽 `.glass-bar` | 玻璃 + `backdrop-filter: blur(16px)` | 內高光 + 柔影 |
| 浮層／彈窗 | 實色卡面（模態可讀性優先，不透出背後文字）+ `--elevation-raised`；遮罩 `--overlay` + `backdrop-blur-md` | 最高層 |
| 回退 | `@supports not (backdrop-filter…)` 回退實色 `card` | — |

- 卡片描邊用漸變光邊（`mask-composite` 疊一圈白到品牌橙的 1px），不是純色邊框。
- 懸浮微交互：`bento-interactive` 上移 1px，只過渡 `transform` 與邊框色；陰影一律不做動畫。
- 骨架屏用 `.skeleton`（單一掃光動畫），減少動態時以靜態色塊替代。

### 性能預算（桌面端卡頓的教訓）

`backdrop-filter` 在桌面 WebView（WebKitGTK／WKWebView）極其昂貴：每個帶模糊的元素都要每幀採樣並重新模糊背後內容，多層疊加會直接吃滿 GPU、拖垮滾動與懸停。因此：

- 極光層靜態且不加 `filter: blur()`——徑向漸變本身已經柔和，全屏模糊純屬浪費。
- `backdrop-filter` 只允許出現在真正浮動於內容之上的大表面：側欄／手機頂底欄（16px）、彈窗遮罩（`blur-md`）、選單浮層（14px）。內容卡、輸入框、按鈕、徽章、開關、分段軌道一律用半透明面，不做背景採樣。模態彈窗的卡面用實色 `card`——半透明卡會讓背後文字透進彈窗正文，這是可讀性事故，不是玻璃質感。
- 一屏可見的 `backdrop-filter` 元素目標 ≤ 3 個；新增玻璃效果前先問「它背後是否真的有需要模糊的動態內容」。
- hover／按壓只動 `transform`（合成器屬性）；`box-shadow`、`filter` 不進 transition 鏈。
- 遮罩與浮層模糊值取小檔（`blur-sm`／14px），不用 2xl 級別。

## Typography

共享介面使用宿主系統字體，跟隨系統縮放。桌面正文 14px，手機閱讀/輸入 16px；頁名用 `title`，模組標題用 `subtitle`，連線主狀態用 `display`，數據用 `code` 或 `tabular-nums`。

- 大標題才用負字距；正文正常，避免彩色玻璃上字形發糊。
- 11px 只用於標籤、單位、計量；必填星號用 `brand-text`，錯誤文字保持紅色語義。
- 輔助文字不得低於 4.5:1；深色模式 `muted-foreground` 維持 0.78 明度。

## Layout

### 外殼

桌面與完整 Web：極光畫布外留 12px 呼吸，左側 248px 玻璃側欄為浮動圓角面板，內容區全幅工作面；兩者都折射畫布極光。側欄分三組：日常（首頁、代理、配置）、排查（連線、規則、日誌、診斷）、底部設定與控制目標。選中行是半透明白底 + 品牌左軌 + 品牌圖示。

手機：玻璃頂欄 + 「首頁、節點、活動、配置」底部標籤欄，設定由頁頭齒輪進入；內容單欄向下流動。

### Bento 網格

- 桌面首頁：雙欄網格，左側較寬，容納連線與流量；右側是策略與偏好。工作區頂部對齊，寬度最多 72rem、高度最多 44rem，避免大視窗把圖表拉成整頁。行高上排為主：連線與策略行按 `minmax(auto,1.4fr)` 取剩餘高度，流量與偏好行貼內容高度，四卡在預設及最小視窗均不滾動。外部控制器的偏好卡按內容決定高度。手機依連線、策略、流量、偏好的順序單欄顯示。
- 引導頁：7/5 欄 Bento —— 左側 Hero 說明卡、左下三張步驟小卡、右側縱向表單卡（跨兩行）；移動端順序為「Hero → 表單 → 步驟」，保證主操作先進首屏。
- 卡片間距 12px，頁面邊距 18px，卡內邊距 16–28px。
- 桌面視窗預設 1200×720，最小 1080×680。首頁在最小視窗維持雙欄，連線按鈕與狀態橫排，四張卡及主要操作同屏可見。連線失敗的原因和重試操作放在對話框，避免推移首頁卡片。
- 首頁連線卡先顯示狀態。本機啟停按鈕有文字標示，桌面與狀態並排，手機放在狀態下方並佔滿欄寬。外部控制器的地址只列一次，並提供管理入口。
- 策略卡按群組、出站節點及策略鏈的順序顯示；有多個群組時使用下拉選單。流量卡在所有尺寸顯示速率、趨勢與用量。偏好卡先列路由模式，本機才列流量接管開關。

### 響應式

採用 Tailwind CSS 的預設視窗斷點，手機優先；未達 `sm` 使用基本樣式。

| 斷點  | 最小寬度 | 用途                         |
| ----- | -------- | ---------------------------- |
| `sm`  | 640px    | 寬手機及緊湊介面             |
| `md`  | 768px    | 側欄及桌面導覽               |
| `lg`  | 1024px   | 工作區雙欄與列表詳情         |
| `xl`  | 1280px   | 寬桌面的不等寬佈局及詳情橫排 |
| `2xl` | 1536px   | 寬屏內容的額外橫向空間       |

頁面版面以視窗斷點控制，卡片與欄位仍須允許收縮及換行。shadcn 原語的容器查詢按元件可用寬度運作，與視窗斷點分開；不另設自訂容器刻度。2K／4K 不等比例放大字體與控件。

### 視口與操作連續性

安全區只預留一次；軟鍵盤出現後欄位與提交仍可見。詳情切換保留草稿、焦點與捲動位置。Web 操作區至少 44×44 CSS px；iOS／Android 按 44pt／48dp 校驗。無障礙：鍵盤焦點、減少動態、對比度為檢查項。

## Shapes

- `rounded-control`（10px）按鈕、輸入、分段、小圖示容器。
- `rounded-card`（20px）模組卡、浮層、面板。
- `rounded-hero`（24px）Hero 卡與引導大卡。
- 舊 `rounded-sm/md/lg/xl/2xl/3xl` 已映射到同一尺度；新代碼用語義名。
- 開關、狀態點、膠囊保留 `rounded-full`。

## Components

### 按鈕

| 變體                   | 用途           | 外觀                       |
| ---------------------- | -------------- | -------------------------- |
| `default`              | 一般主操作     | 石墨漸變、紙白字、低投影   |
| `brand`                | 連線、保存帳號 | 深橙漸變、白字             |
| `outline`／`secondary` | 次要操作       | 玻璃按鈕（`glass-button`） |
| `ghost`                | 工具列與行內   | 懸停才出現玻璃底           |
| `success`              | 完成類操作     | 薄荷漸變、深墨字           |
| `destructive`          | 刪除、中斷     | 紅底、白字                 |

高度：預設 34px、`sm` 30px、`lg` 40px；手機主要操作 ≥ 44px。懸停上浮與陰影加深，按壓輕微回縮；焦點用 3px 品牌低透明內環。

### 輸入與設定行

輸入框 36px、`field-glass`（54% 畫布色玻璃 + `border-strong` 邊 + 內高光），聚焦邊框轉品牌色。標籤在上方，錯誤緊跟欄位並給出解決方式；快捷填入用品牌文字按鈕而非灰框。開關 46×28，白色滑塊，開啟用品牌橙漸變。分段選擇用玻璃軌道，選中是白色浮起膠囊；Tabs 與分段同規則，不整塊鋪橙。

### 卡片與模組

- `Card`／`.bento` 是任務容器：玻璃、光邊、柔影、大圓角。
- 卡內再分組用 `.bento-inset` 小模組（數據、設定行、快捷入口），不套多層實色卡。
- 卡面一律中性玻璃；模組身份靠內容、小圖示與狀態色表達，不用彩色卡面 wash。

### 狀態反饋

- 載入：模組內骨架 + 按鈕內 spinner；資料流重連顯示「重新連接中」。
- 錯誤：紅色玻璃提示卡，包含標題、原因與一個明確動作；不用代碼原文對使用者。
- 空/首次：用 Bento 小卡引導下一步，不做死胡同。
- 成功：原位確認（如「已複製」），失敗保留原值與恢復入口。
- 未知、未啟用、失敗、過期必須分開表述；不用綠點或動畫代替事實。

### 動畫

- 極光背景靜態不動，不佔每幀合成預算。
- 按鈕 140–220ms 上浮/回縮；卡片懸停 220ms；彈層用淡入 + 輕縮放。
- 骨架掃光 1.4s 循環；減少動態時靜止。

## Do's and Don'ts

### Do

- 用玻璃卡、柔和陰影和極光營造層次；讓每張卡只回答一個任務。
- 漸變克制：只有品牌橙一種；極光最多兩色、低透明，不給每張卡配一種顏色。
- 保證文字在彩色玻璃上對比充足；用等寬數字表達速率與配額。
- 為每個操作路徑準備載入、空、錯誤、成功四態。

### Don't

- 不把極光或玻璃做成干擾閱讀的強圖案；不整頁鋪橙，也不做彩色卡片迷宮。
- 不用多層實色卡疊加；不用硬陰影和強描邊；不疊加多種彩色漸變。
- 不在首頁塞入全量策略、日誌或表單；不讓次要操作搶主操作。
- 不用動畫代替狀態事實；不做長時間循環閃爍；不給小控件加背景模糊。
- 不把 2K／4K 當放大版手機。

## 實作對照

| 層 | 位置 |
| --- | --- |
| 令牌 | `packages/client-ui/src/styles/tokens.css` |
| 極光/玻璃/骨架/陰影 | `packages/client-ui/src/styles/app.css` |
| 基礎原語 | `packages/client-ui/src/components/ui/` |
| 外殼與導覽 | `packages/client-ui/src/app/app-shell.tsx`、`app/navigation/` |
| 首頁 Bento 網格 | `packages/client-ui/src/features/connect/connect-page.tsx` |
| 引導頁 Bento | `packages/client-ui/src/features/connect/external-controller-onboarding.tsx` |

新增或修改原語後，至少檢查桌面與手機寬度、明暗主題、鍵盤焦點、減少動態、載入/空/錯誤/成功四態。Web 截圖不能代替 macOS、Windows、iOS、Android 的實際平台驗收。

> AI生成
