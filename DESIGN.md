---
name: XBond 用戶端設計系統
description: 沿用 cloud 控制台的橙色品牌與潔淨白色層次，配合桌面及流動裝置的日常連線操作。
colors:
  brand: "oklch(0.7163 0.1706 53.45)"
  brand-strong: "oklch(0.66 0.18 52)"
  brand-foreground: "oklch(0.187 0 0)"
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
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "normal"
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
  control: "calc(0.625rem - 2px)"
  card: "calc(0.625rem + 4px)"
  rail: "1rem"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
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

## 概覽

**設計核心：「隨身連線，從容掌握」。**

沿用 cloud 控制台的設計語言：橙色品牌標記、潔淨白色表面、中性灰層次、輕巧懸浮側欄及清楚的狀態提示。介面以卡片組織獨立任務，留白讓連線、節點與用量容易閱讀；細節服務操作，不以裝飾取代資訊。

桌面及流動裝置屬於同一產品。視覺節奏保持一致，版面密度、觸控範圍及導覽方式配合裝置調整。日常操作簡單直接，策略、規則、網絡活動及診斷仍有完整入口。

本文是已確認的設計基準。色彩令牌取自 cloud 控制台及目前 `packages/client-ui/src/styles/tokens.css`；四項底部導覽、呼吸光環、圖形化配額環、流量羅盤及快捷匯入是今次確認的設計要求，並非全部已實作或已通過驗證。落實差距及驗證結果統一記錄於[重設計任務](docs/tasks/client-design-refresh.md)。

**主要特徵：**

- 卡片化、大留白、有呼吸感；同一任務內緊湊，不同任務間留有空間。
- 呼吸光環提示已知的連線狀態，配額環配合文字數值表達剩餘用量。
- 桌面側欄分類親和清楚，手機維持四項底部導覽。
- 複製、匯入及切換節點有直接入口、明確回應及失敗後的處理方法。
- 文字平實自然，尊重用戶的時間、選擇與心理負擔。

## 色彩

品牌橙沿用現有標誌的原色。白色是主要工作表面，極淺中性灰只用於區分畫布與卡片；不使用帶黃褐色的底色。深色主題保留相同層級，以鈦灰表面配合品牌橙。

| 角色 | 令牌 | 用途 |
| --- | --- | --- |
| 品牌主色 | `brand`、`brand-strong` | 標誌、主要品牌操作、選中指示、用量主序列及鍵盤焦點 |
| 品牌文字 | `brand-text`、`brand-text-dark` | 白底或深色表面上的連結及小字強調 |
| 工作層級 | `background`、`card`、`surface-inset`、`popover` | 畫布、卡片、凹面欄位及浮層；對應深色令牌保持層級 |
| 文字與邊界 | `foreground`、`muted-foreground`、`border`、`border-strong` | 正文、輔助說明、結構分隔及可操作邊界 |
| 就緒與成功 | `success`、`success-text` | 已知就緒、已完成操作及正常量度結果 |
| 注意事項 | `warning`、`warning-text` | 配額或有效期提醒、需要留意的狀態 |
| 中性資訊 | `info` | 操作說明、正在處理及資訊提示 |
| 錯誤與移除 | `destructive`、`destructive-text` | 失敗狀態、離線結果及刪除確認 |

**品牌留白規則。** 橙色是主色，但不把整張資訊卡或整個側欄填滿橙色。品牌靠標誌、焦點、選中狀態及主要操作形成一致辨識度。

**文字對比規則。** 亮色狀態令牌用於圓點、圖形及進度，文字使用對應的文字級令牌。橙底配深色字，不配白字；沿用 cloud 的品牌按鈕構圖，淺色為近黑底配橙字，深色為橙底配深色字。狀態同時配文字或圖示，不只靠顏色分辨。

## 字體

採用自託管 Inter Variable 配合系統中文字體；香港繁體中文使用裝置可用的繁中字形。系統字體名稱保留原名，不把字體家族名稱當作介面文案翻譯。

| 層級         | 用途                 | 表達方式                              |
| ------------ | -------------------- | ------------------------------------- |
| 頁面標題     | 目前工作位置         | `title`，清楚、精簡，不另加裝飾性眉題 |
| 卡片標題     | 獨立任務或資料分組   | `subtitle`，與內文形成穩定層級        |
| 正文與控制項 | 操作說明、表單及列表 | `body`，避免密集小字承擔主要操作      |
| 輔助文字     | 時間、狀態補充及單位 | `label`，顏色仍須清楚可讀             |
| 技術資料     | IP、網址及識別碼     | `code`，放在可辨識的資料區域          |

中文不增加裝飾性字距，不以全大寫英文字或大量縮寫製造層級。流量、金額、日期及延遲採等寬數字，單位與數值同時顯示。主要文字對其實際背景至少達 4.5:1，大字及功能圖形至少達 3:1；這是驗收要求，不代表目前已完成量度。

文件及預設繁體中文文案採香港用語：用戶、用戶端、流動裝置、網絡、設定、匯入、複製、載入、儲存、重新整理、連線、伺服器及程式碼。保留標誌、協定、技術識別碼及其他語言版本的原有名稱。

## 版面

**任務分組規則。** 一張卡片處理一項獨立任務；相關欄位緊靠，任務之間留白。大留白不等於隱藏資訊；進階列表、連線記錄及日誌可以較密集，但保留一致的字體、邊界及操作語言。避免卡片層層相套。

桌面採左右兩個獨立浮島：左側是 cloud 風格的淺色懸浮側欄，依日常使用與偏好設定分類；右側是佔滿剩餘視窗寬度的圓角工作區，保留外圍間距、細邊框及輕柔陰影，不以置中的最大寬度限制浪費寬屏空間。工作區內以卡片及列表組織內容，標題、狀態與主要操作先於次要資料。暗色側欄與工作區跟隨主題，不強行固定為黑色。

手機底部維持四項常駐導覽：「首頁」、「節點」、「活動」、「設定」。訂閱與配置由首頁的目前訂閱卡片及設定內的「訂閱與配置」進入，不增設第五項常駐分頁。桌面可有更多次級入口，跨裝置的名稱、狀態與操作結果保持一致。

桌面側欄直接提供「首頁、代理、訂閱、連線、規則、日誌、測試、設定」八項入口，不套用手機的收斂方式。側欄底部設控制器選擇器，可直接切換已儲存的控制器；編輯入口分開保留。同名控制器配合位址分辨，切換後資料及操作均以新對象為準。

桌面首頁以 XBond 自身的橙白設計組織完整操作：策略組與節點選擇、訂閱更新、接管模式、區域網絡設定、實際流量走勢、核心與連線狀態及診斷入口。內容直接展開，不用「狀態詳情」等摺疊區隱藏必要資訊。手機保留連線、節點、訂閱與精簡流量資訊，較少使用的控制由其他頁面進入。其他用戶端截圖只作功能覆蓋與便利度參考，不沿用其版面及配色。

窄屏採單欄閱讀，主要操作在拇指容易觸及的位置；互動目標以至少 44 × 44 CSS 像素為驗收基準。底部導覽預留裝置安全區，表單及頁尾操作不被遮擋。資料表可在自身區域橫向捲動，整頁不應橫向溢出。

## 層次與深度

白色卡片、中性畫布及凹面欄位形成清楚層次，深度沿用 cloud 的細邊框與輕柔向下陰影。浮層比一般卡片更突出；陰影不與橙色光環混為一談。深色以微亮邊界及內高光保持層級，不只是把白底反轉成黑底。

陰影、過渡時間及斷點的具體值記錄在 `.impeccable/design.json`，色彩與字體的標準值由本文頁首令牌維護。實作期間更新令牌時，兩份文件須同步核對。

## 形狀

控制項採小圓角，卡片採柔和但不誇張的圓角，懸浮側欄稍大。標準值見頁首 `rounded`。圓形只用於有含義的狀態點、光環、配額環或圖示背景，不把所有按鈕做成膠囊形。

圖示採同一套線條粗幼與尺寸；節點供應者原有的名稱可保留，但介面控制不以表情符號代替圖示。

## 元件

### 按鈕與輸入欄位

每個區域只有一個明確的主要操作，次要操作採外框或文字按鈕。品牌按鈕沿用 cloud 的明暗構圖；焦點輪廓清楚可見。載入中、停用、成功及失敗狀態各有文字回應，提交期間避免重複操作。

網址、識別碼及可複製資料採等寬字體；輸入欄位提供清楚標籤，不只依靠提示文字。錯誤緊貼相關欄位，說明目前問題及可採取的下一步。

### 連線狀態與呼吸光環

呼吸光環只附於連線狀態標記，低幅度、慢節奏地提示已知運作狀態，不在整個頁面持續閃動。呼吸週期的設計目標為 2.4 秒；一般狀態切換沿用現有短過渡時間及無回彈緩動。

連線中、代理運行中、未連線、狀態未知及操作失敗均有清楚文字。核心可達、本機流量已接管及外部連通是不同事實，不因光環亮起便宣稱全部正常。啟用減少動態效果時，取消循環與位移動畫，保留靜態圖示、顏色及文字。

### 訂閱卡片與圖形化配額環

訂閱卡片借用 cloud 通行證的分區節奏：上方名稱、有效期及主要操作，下方用量與補充資料。保留輕巧分隔，不為擬物效果加上多餘圖案。

配額環以實際剩餘配額佔總額的比例繪製；旁邊同時列出「剩餘」、「已用／總額」及有效期。流量重設時間與服務到期時間分開顯示，只有取得相應資料才呈現。已用量超出總額時，圖形停在邊界，文字仍如實顯示超額。

沒有總配額、數據未載入、讀取失敗與剩餘為零是不同狀態；不可一律畫成空環或滿環。配額不明時用「未有配額資料」，並保留重新整理或查看配置的途徑。圖形提供可存取名稱、數值與上限，輔助技術不用靠顏色或動畫理解內容。

### 流量羅盤

流量羅盤是用量概況元件，協助用戶掌握目前資料流動；不是地理定位、匿名程度或安全評分。將下載、上載、核心累計及訂閱餘額放在清楚命名的區域，實際時間範圍與來源隨資料顯示。

即時速度、累計流量與訂閱配額不混用。只有持續取得真實樣本才繪製歷史走勢；暫停更新或資料來源中斷時，標示資料狀態，不能以持續動畫假裝仍有流量。

### 複製與匯入

複製按鈕緊貼目標資料，標籤清楚指出要複製甚麼。成功後在原處顯示「已複製」；失敗時保留可選取的文字並提示手動複製。敏感資料不因提示、截圖或日誌而額外展示。

「匯入至 XBond」用於把訂閱或配置加入目前用戶端。若有跳轉至其他相容用戶端的操作，必須列明目標名稱，並以實際支援的匯入方式為準。無法直接開啟目標時，提供複製連結及步驟；只有配置實際加入後才顯示「已匯入」。

### 節點切換

選擇節點前先說清目前策略組與已選節點；多個策略組不合併成未經證實的「所有流量出口」。切換過程顯示待處理狀態，收到成功結果後才更新選中樣式；失敗時保留原選擇並提供重試。

「平滑換節點」指介面保持位置與選擇脈絡、操作回應連貫，不代表既有連線必定不中斷。斷開相關連線的選項須說明影響，保留用戶決定。節點切換已成功，但後續狀態更新或連線清理失敗時，分開說明部分完成的結果，不誤報為節點未有切換。

### 文字與回應

用語平實自然，先交代目前情況，再提供下一步。未連線不是失敗，缺少配置不是用戶犯錯；避免責備、催促、恐嚇或沒有依據的安全承諾。

| 情境     | 建議用語                                         |
| -------- | ------------------------------------------------ |
| 首次使用 | 「加入訂閱或匯入配置，即可開始使用。」           |
| 複製完成 | 「已複製」                                       |
| 匯入完成 | 「已加入訂閱，可返回首頁連線。」                 |
| 未有數據 | 「暫時未有流量資料。」                           |
| 切換失敗 | 「未能切換節點，目前選擇維持不變。請再試一次。」 |
| 配額不明 | 「未有配額資料」                                 |

## 使用準則

- 採用橙色品牌、白色工作表面及清楚的語義輔助色，明暗主題保持相同資訊層級。
- 手機維持四項常駐導覽，讓訂閱與配置從首頁及設定容易找到。
- 動效只表達狀態與操作結果，並完整支援減少動態效果。
- 配額環、流量羅盤及選中狀態必須來自真實資料，並配合文字呈現。
- 複製、匯入及換節點都有明確回應；失敗後仍能繼續處理。
- 不以橙底白字、大面積橙色卡片、持續閃動或過度裝飾增加心理負擔。
- 不把代理運作、流量接管或服務連通混成單一未經核實的成功承諾。
- 不把設計要求寫成已交付能力；尚未完成的實作及驗證保留在任務記錄。
