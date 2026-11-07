---
name: XBond 用戶端設計系統
description: 冷瓷色畫布、暖橙緞帶、近白工作面及清楚的操作與狀態層級。
colors:
  brand: "#F7720D"
  brand-highlight: "#FF914D"
  brand-action: "#F7720D"
  brand-action-foreground: "#FFFFFF"
  brand-text: "#A84000"
  brand-soft: "#FEEBDD"
  background: "#EFF1F8"
  sidebar: "#F8F8FC"
  card: "#FBFBFE"
  surface-inset: "#F3F5FA"
  foreground: "#101622"
  muted-foreground: "#525B6C"
  border: "#D6DDE8"
  control-border: "#818B9C"
  highlight-edge: "#FFFFFF"
  success: "#007D46"
  success-soft: "#E3F5EE"
  upload: "#8DAAD3"
typography:
  display:
    fontSize: "2.75rem"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  headline:
    fontSize: "2.125rem"
    fontWeight: 700
    lineHeight: 1.2
  metric:
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.2
    fontFeature: '"tnum"'
  title:
    fontSize: "1.375rem"
    fontWeight: 650
    lineHeight: 1.3
  body:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  control: "0.875rem"
  card: "1.375rem"
  sidebar: "1.5rem"
  pill: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  gutter: "2rem"
components:
  button-brand:
    backgroundColor: "{colors.brand-action}"
    textColor: "{colors.brand-action-foreground}"
    rounded: "{rounded.pill}"
    height: "3rem"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: "2.75rem"
  nav-item-active:
    backgroundColor: "{colors.brand-soft}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: "3rem"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "{spacing.xl}"
  field:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: "2.75rem"
  segment-selected:
    backgroundColor: "{colors.brand-soft}"
    textColor: "{colors.brand-text}"
    rounded: "{rounded.control}"
  switch-track:
    backgroundColor: "{colors.surface-inset}"
    rounded: "{rounded.pill}"
    width: "2.875rem"
    height: "1.625rem"
  status-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    rounded: "{rounded.pill}"
---

# XBond 用戶端設計系統

<!-- impeccable:design-schema 1 -->

## Overview

**視覺方向「冷瓷與暖橙緞帶」**

冷灰藍畫布承托近白工作面。深墨色建立資訊層級，白色細邊與低而柔的陰影分隔表面。暖橙緞帶從留白處切入，為工具介面保留可辨識的品牌輪廓。

- 大面積表面維持冷白，集中使用橙色，讓主要操作和當前選擇容易辨認。
- 資訊、操作、狀態有各自的視覺語彙。面板按任務分組，標題、讀數與操作沿共用邊線對齊。
- 兩張淺色桌面設計圖是本系統的視覺依據。前置資料定義淺色設計令牌，尺寸按圖面比例換算。深色、動態與窄屏沿用下文的應用規則。

## Colors

| 色彩角色 | 令牌 | 用法 |
| --- | --- | --- |
| 品牌標記 | `brand`、`brand-highlight` | 標誌、選中側軌、主要數據及緞帶高光 |
| 主要操作 | `brand-action`、`brand-action-foreground` | 橙色實底或緞面漸變，搭配白色標籤與圖示。由亮橙漸變至品牌橙 |
| 選中與強調 | `brand-soft`、`brand-text` | 柔桃底、深橙標籤和圖示，用於當前項目、資源標記及重點連結 |
| 工作面 | `background`、`sidebar`、`card`、`surface-inset` | 分別用於畫布、導覽、面板及內嵌控件 |
| 文字 | `foreground`、`muted-foreground` | 墨色用於標題、正文、讀數。灰藍用於次要標籤與說明 |
| 邊線 | `highlight-edge`、`border`、`control-border` | 分別用於表面受光邊、資訊分隔、控件必要輪廓 |
| 已確認正常 | `success`、`success-soft` | 綠色文字或圓點搭配淺綠底，用於可確認的正常結果 |
| 數據序列 | `brand`、`upload` | 橙色標示下載及主要配額，淡藍標示上傳。圖表同時提供圖例或可區分的線型 |

當前選擇、鍵盤焦點和服務狀態各有獨立樣式。未知與未連線使用中性色和明確文字。警告與錯誤配對應圖示及短句。深色主題按同一角色重新配色，重新校驗前景、背景及邊界的對比度。

## Typography

字體沿用 `body.fontFamily` 的系統無襯線堆疊。保留宿主文字縮放，中文、拉丁字母與數字共用同一排版尺度。

| 文字角色 | 令牌       | 用法                               |
| -------- | ---------- | ---------------------------------- |
| 焦點     | `display`  | 一個工作區內最主要的狀態或焦點文字 |
| 頁標題   | `headline` | 工作區名稱，下面可接一句較輕的說明 |
| 重點讀數 | `metric`   | 速率、延遲、百分比及其他關鍵量值   |
| 區塊標題 | `title`    | 面板、資源及詳情區名稱             |
| 正文     | `body`     | 說明、表單、導覽和操作文字         |
| 標籤     | `label`    | 欄位名稱、圖例、徽章與輔助資訊     |

同一區塊的動態讀數和計時採等寬數字，單位緊跟數值。長名稱可換行，需截斷時提供可用鍵盤及觸控取得全名的途徑。

## Layout

- **間距。** `xs`、`sm` 連接圖示、文字和附屬資訊。`md`、`lg` 分隔同組控件或相鄰模組。`xl` 作面板內距，`gutter` 分隔導覽和工作區。同級面板保持一致的邊線及內距。
- **外殼。** 寬窗使用浮動左側欄及可伸縮工作區。側欄以分隔線區分導覽群組，底部可放目前操作對象。工作區的頁標題和頂部操作共用同一對齊線。原生視窗保留宿主的拖曳區、視窗按鈕及安全區。
- **網格與面板。** 依資訊重要性與內容寬度分配欄位。同組的欄以共同頂緣起排；只有需要比較或共用一個操作時才讓底緣齊平。清單與詳情並排時，清單保持可掃讀的寬度，詳情使用剩餘空間。
- **窄窗與縮放。** 先收窄外部留白，再換行或切成單欄。清單與詳情可拆成兩個視圖並提供返回途徑。操作列、狀態列和徽章組可換行，標籤與控件保持相鄰。按宿主採用適合的導覽和觸控區。

## Elevation & Depth

| 表面 | 材質與層次 |
| --- | --- |
| 畫布 | 冷灰藍基底加局部淡暖光，平面呈現 |
| 側欄與面板 | 冷白或近白面，加 1px 受光邊與環境陰影 `0 2px 5px #2436540a, 0 14px 30px -18px #24365426` |
| 內嵌區 | 稍深的冷色面配細分隔線，與外層面板保持清楚邊界 |
| 浮層 | 近實色工作面配較集中的陰影 `0 8px 26px -10px #24365440`，遮住下層文字 |

緞帶由數片不同曲率的半透明橙色弧面交疊，受光邊窄而亮，尾端淡入畫布。每個工作區最多一處主緞帶，放在上方留白；內層工作面只可用更淡的局部暖色。緞帶保持靜態，空間不足時可裁切或隱藏。透光感以色面、細邊和陰影為主，模糊僅用於經宿主性能驗證的浮層。

## Shapes

- `sidebar` 給外殼導覽面，`card` 給主要面板，`control` 給輸入、選項、次要操作與圖示底座，`pill` 給主操作、開關軌道及狀態徽章。
- 輪廓、受光邊及分隔線以 1px 為基準。當前導覽項以約 3px 的短橙軌補足位置辨識。
- 圖示使用同一套線性筆觸。行內圖示以 16px 為基準，導覽及操作使用 20px，面板或資源識別可用 24px。純圖示操作提供可讀名稱。

## Components

| 元件 | 樣式與使用條件 |
| --- | --- |
| 主按鈕 | `button-brand` 使用橙色膠囊與白字，可配動作圖示。用於同一操作區最重要的動作 |
| 次要按鈕 | `button-secondary` 使用近白面、冷灰輪廓及墨色文字。行內低強調操作可用文字或圖示 |
| 導覽項 | 預設透明底與灰藍圖示。當前項用 `nav-item-active`、短橙軌、橙色圖示及較重的標籤 |
| 選擇列 | 柔桃底和細橙邊表示已選。若同時需要顯示生效狀態，另用勾號與文字。進入詳情的列以箭頭提示 |
| 輸入、搜尋及下拉 | 共用 `field` 的偏冷淺底與輪廓。搜尋配放大鏡，下拉配展開箭頭，錯誤說明緊鄰控件 |
| 分段選擇 | 中性軌道承載同層互斥選項。`segment-selected` 用柔桃底、深橙字和細邊。整組有可讀名稱，焦點與選中各自可辨 |
| 開關 | `switch-track` 為圓角軌道。關閉用中性軌道，開啟用品牌橙，白色滑塊位置同步變化。控制項名稱放在旁邊並保持固定 |
| 徽章 | 中性徽章標示類型或屬性。`status-success` 用綠點與文字標示確認結果，橙色徽章表示當前選擇或已生效。操作使用按鈕樣式 |
| 面板 | `card` 以近白工作面、細亮邊和柔影分組。只有整塊可操作的面板才使用懸停與焦點樣式 |
| 指標與圖表 | 標籤、讀數、單位一起呈現。線圖採淡色網格，缺測留空。比例可用進度條或環形圖，配可讀數值與量度語境 |

### 共用狀態

- **懸停與按下。** 懸停改變色面、邊線或下劃線，按下進一步加深。版面與標籤位置保持穩定。
- **鍵盤焦點。** 使用 2px 清晰外環及 3px 間隔，淺色用 `brand-text`。焦點在選中與錯誤狀態下仍可辨認。
- **處理中與停用。** 保留控件尺寸，更新文字或加入小型進度提示。操作受限時在控件旁說明條件。
- **空白、未知與失敗。** 用中性圖示與簡短文字表達空白或未知，失敗說明原因，並在可恢復時提供下一步。零值、未知值與上次量度各自標示。
- **動態。** 互動轉場以 120–180ms 為基準，集中於顏色與透明度。減少動態模式保留即時狀態回饋。

## Do's and Don'ts

- **沿用語義令牌。** 先決定元素是操作、選擇、狀態或數據，再套用對應配色與元件。
- **用文字與形狀補足顏色。** 選中、已啟用、成功及錯誤均可獨立讀懂，讓不同狀態在灰階也能辨認。
- **保留可讀性。** 一般文字達 4.5:1，大字及必要控件邊界達 3:1。按宿主校驗觸控範圍、鍵盤焦點及文字縮放。
- **節制層次。** 大面積工作面維持冷白。緞帶置於留白，表面靠亮邊與柔影分層，讓資料與控制項保有清楚輪廓。
