# 領域文件

工程 skill 在探索程式碼之前，按下面的約定讀取本倉庫的領域文件。

## 探索之前先讀這些

- **`CONTEXT.md`**（倉庫根目錄）：XBond 客戶端與「隨行連接」的業務概念及統一名稱。
- **`PRODUCT.md`**：涉及產品範圍、用家旅程、三層狀態表達、優先級或公開文案時讀它。
- **`DESIGN.md`**：涉及視覺層級、設計令牌、色彩、排版與響應式佈局時讀它。
- **`docs/adr/`**：讀與你要改動的區域相關的架構決策記錄（ADR）。

輸出裏出現領域概念時（任務標題、重構提案、假設、測試名），用詞彙表定義的叫法，不要漂移到它標註「避免」的同義詞。需要長期行為的上下文就讀對應的 `docs/specs/` 規格。

## 檔案結構

單上下文倉庫，全倉庫（Go 核心、CLI、React Web 界面與 Tauri 跨端殼）共用一份詞彙表與一份架構決策：

```text
/
├── AGENTS.md           ← Agent 開發規範與工作流指令
├── CONTEXT.md          ← 領域詞彙表
├── PRODUCT.md          ← 產品範圍與體驗契約
├── DESIGN.md           ← 視覺與交互設計系統
├── go.mod              ← 根 Go Module (github.com/openxbond/xbond)
├── package.json        ← 統一命令管理入口（Web、Go CLI、Tauri 桌面與發佈腳本）
├── docs/
│   ├── adr/            ← 架構決策記錄
│   ├── agents/         ← 本目錄，skill 的倉庫配置
│   ├── specs/          ← 長期行為規格與開發管線
│   └── tasks/          ← 路線圖總控與任務記錄
├── cmd/ ipn/ engine/ profile/ sysproxy/ netcheck/ paths/ version/  ← Go 頂層套件
├── web/                ← React Web 前端源碼與測試 (index.html, src/, public/, tests/)
├── tauri/              ← Tauri 2 桌面與行動端宿主工程
└── scripts/            ← 面向 openxbond/dashboard 公開產物倉庫的 TypeScript 校驗與發佈腳本
```

## 用詞彙表裏的說法

如果需要的概念還不在詞彙表裏，這是一個訊號：要麼你在造專案裏不存在的詞（重新想），要麼確實有缺口（記下來交給 `/domain-modeling`）。

## ADR 衝突要擺到明面上

如果產出與已有 ADR 矛盾，明確說出來，不要默默覆蓋：

> _與 ADR-002（單一內嵌 sing-box 庫）矛盾，但值得重開，因為……_
