# XBond 客戶端開發約定

項目狀態：目前處於開發階段，唔需要做舊版本兼容處理。

## 專案與入口

本倉庫是 XBond 客戶端；Cloud 控制面在另一個倉庫。本倉庫使用 pnpm、Go 及 Rust，命令以根目錄 `package.json` 為準。

- `cmd/xbond/`：單一二進位的 CLI；`daemon` 子命令本機前景運行，`service` 子命令組註冊使用者級自啟。`internal/daemon/`：本機服務與 LocalAPI；`internal/daemon/service/`：平台託管（systemd --user／LaunchAgent／HKCU Run）。
- `internal/engine/`：sing-box；`internal/sub/`：訂閱與配置；`internal/platform/`：資料位置與系統代理；`internal/diag/`：診斷與脫敏。
- `apps/dashboard/`：網頁入口及靜態資源；`apps/desktop/`：桌面入口與 `src-tauri/` 原生殼；`apps/mobile/android/`、`apps/mobile/ios/`：原生接入；`mobile/` 保留 gomobile 公開入口。
- `packages/client/`：無 React 的控制器、配置及傳輸；`packages/client-ui/`：React 19、React Router、Jotai、UnoCSS 共用畫面。
- `scripts/`：移動端檢查、Web 產物封裝及發佈轉交。

新增宿主、共享能力或跨倉庫契約時，讀 [用戶端體系](docs/architecture/client-system.md)。依賴方向為 apps → client-ui → client；跨 package 走已宣告的 exports，宿主啟動探測留在 client 外。執行 `pnpm check:architecture` 驗證方向與依賴宣告。

## Code-first 入口

修復、功能、重構、UI、審查及發佈任務，按 [開發管線](docs/specs/dev-pipeline.md) 的入口路由選擇流程。小改不必先寫 spec、plan 或票；以可審查的程式碼、行為測試與實際運行結果交付。未完結的功能或跨會話工作才需要任務記錄。規格表達承諾，程式碼表達實作；兩者衝突時查明原因，不以現有 bug 改寫驗收要求。

先讀相關現有程式碼及測試，沿用既有接口與模組邊界。結構探索使用已安裝的 `codebase-memory` skill，檢查索引覆蓋；未覆蓋、過期或工具不可用時直接讀取來源，並說明限制。

## 開發與驗證

- 安裝：`pnpm install --frozen-lockfile`；Node ≥ 24（`scripts/*.ts` 直接執行，不帶 `--experimental-strip-types`）。版本以 `package.json`、`go.mod`、`apps/desktop/src-tauri/Cargo.toml` 為準。
- Web：`pnpm dev`（預設 3000）；`pnpm check` 一次跑 typecheck、lint（含架構檢查）、format、test；交付前另跑 `pnpm build`；`pnpm test:watch` 進入 watch 迴圈。
- Go：`pnpm cli:run [args]` 本機執行 CLI；`pnpm cli:daemon` 前景運行 daemon；`pnpm cli:fmt`／`cli:fmt:check`（gofmt）；`pnpm cli:check` 為 vet、test、build。build tags 的單一來源在 `scripts/go.ts`；包路徑、`-run`、CLI 參數等額外參數直接附在命令後（如 `pnpm cli:test ./internal/sub -run TestX`）。
- daemon 生命週期：CLI 不直接 spawn daemon 進程；`xbond service install` 把 `xbond daemon --background` 註冊到平台使用者級 supervisor，`service stop` 經 LocalAPI shutdown 端點優雅退出。服務未安裝時任何 CLI 命令會自動註冊並啟動（免管理員）。
- 桌面：`pnpm dev:desktop`（前端，固定 127.0.0.1:1420）加 `pnpm desktop`（Tauri 殼）；`pnpm desktop:fmt`／`desktop:fmt:check`、`pnpm desktop:check`、`pnpm build:desktop`。
- 移動端：`pnpm mobile:check` 只驗證 Go 接口；原生接入另須目標平台工具鏈及裝置驗證。
- 格式：`pnpm exec oxfmt --check <本次檔案>`；`git diff --check`。可選 `pnpm hooks:install` 安裝 lefthook pre-commit，對提交中的檔案跑同樣的 oxfmt 與 oxlint 檢查。
- CI（`.github/workflows/`）複用同一批命令：`ci.yml` 跑 web 與 Go 門禁；`desktop-check.yml` 僅在 `apps/desktop/src-tauri/` 等路徑變更時跑桌面檢查。
- 按 [驗證矩陣](docs/agents/verification.md) 選最窄檢查；只報實際執行結果。沒有在目標平台驗證的能力，保留待驗證狀態。

## 實作規則

- 最簡單的正確實作；有第二個真實用途才抽象。避免轉發包裝、無用註解、覆蓋率專用測試及投機設計。
- TypeScript 避免 `any` 和無必要斷言。Go 檢查錯誤；核心狀態不以吞錯或靜默回退偽裝成功。
- 新增或修復可觀測行為時，以失敗場景、行為測試或可重現命令證明；不為純格式或文案修改加測試。
- 沿用 build tags、平台檔案及現有依賴。修改契約時核對 Go、LocalAPI、Web、Tauri／原生端的相關消費者。
- 不覆寫已有未提交改動，不整倉格式化，不把未完成介面或模擬資料當作已交付能力。
- 訂閱、控制器憑證、LocalAPI token 及診斷原始資料不進提交、日誌或截圖。
- 啟停本機服務、改系統代理／TUN 或執行真實網絡測試前說明影響；使用獲授權的測試環境並還原設定。
- 一般不切分支，直接提交到 `main`；只有明確要求（如修特定 bug、開發新功能）才新建分支，命名按 conventional 提交前綴（`feat/`、`fix/` 等）。本機建置／封裝可執行；合併、公開發佈、轉交產物與變更遠端資源須有本次任務或既有授權。

## 產品與介面

產品能力與用戶旅程讀 [PRODUCT.md](PRODUCT.md)；UI 變更另讀 [DESIGN.md](DESIGN.md) 及對應程式碼／現有截圖。UI 工作使用已安裝的 Impeccable，遵守其上下文載入與有界視覺驗證流程；一般操作介面採 Operate 模式。介面任務的具體要求見 [UI 分支](docs/specs/dev-pipeline.md#ui-分支)。

未知、未連線、操作失敗與成功是不同事實；核心運行、流量接管及外部連通不得合併為無依據的成功。設計目標與已驗證能力分開記錄。

## Agent skills

### Issue tracker

本地 Markdown 任務記錄位於 `docs/tasks/`，GitHub Issues 不作任務載體。見 [任務載體](docs/agents/issue-tracker.md)。

### Triage labels

五個預設角色寫在任務的 `分診：` 行，與施工狀態分開。見 [分診詞彙](docs/agents/triage-labels.md)。

### Domain docs

單上下文：根 [GLOSSARY.md](GLOSSARY.md) 是詞彙表，`docs/adr/` 保存決策。載入規則見 [領域文件](docs/agents/domain.md)。

## 文件約定

`AGENTS.md` 是跨工具的規則入口；工具專屬 adapter 不作第二份事實來源。工作流與指令維護在本文及指向的文件，避免複製整份第三方 skill。

文件採繁體中文，技術名稱保留原名。Markdown 段落不硬換行（`proseWrap: "never"`）；import 排序交給 Oxfmt。長期行為用 [規格格式](docs/specs/spec-format.md)，進度與證據用 [任務記錄](docs/tasks/README.md)。規則變更須檢查入口、連結、命令與完成條件是否一致。
