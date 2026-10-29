# XBond

XBond 是網絡代理用戶端，包含 Go CLI 與本機服務、React Web 介面、Tauri 桌面殼及行動端接入程式碼。產品範圍與平台限制見 [PRODUCT.md](PRODUCT.md)。

## 本機開發

1. 按 `package.json` 的 `packageManager` 準備 pnpm，按 `go.mod` 準備 Go；桌面工作另需 Rust 與 Tauri 的平台建置依賴。
2. 執行 `pnpm install --frozen-lockfile`。
3. Web 介面執行 `pnpm dev`（預設埠 3000）；桌面開發執行 `pnpm desktop`（介面埠 1420）。

Web 可作遠端控制器介面；完整本機能力依賴本機服務及權限。只有介面啟動，不代表系統代理、TUN 或實際連通已通過驗證。

## 開發流程

採用 **Code-first**：從既有程式碼與可重現行為出發，實作最小端到端切片，以測試和運行證據審查，再同步必要的契約與決策。

- [Agent 開發約定](AGENTS.md)：倉庫結構、命令及共通規則。
- [開發管線](docs/specs/dev-pipeline.md)：入口路由、實作、UI、審查、發佈與維護。
- [驗證矩陣](docs/agents/verification.md)：按變更範圍選命令及平台驗收。
- [任務記錄](docs/tasks/README.md)：功能與跨會話工作；小修可直接使用 diff 與交付摘要。
- [Code-first 決策](docs/adr/001-dev-pipeline.md)：理念及取捨。

命令入口是根 `package.json`。目前倉庫沒有提交 GitHub Actions 工作流；上述命令需由開發者或 Agent 執行，不能視為已自動執行的 CI。

## 工程與擴展

宿主入口在 `apps/`，共享畫面在 `packages/client-ui/`，無 React 的控制器與傳輸在 `packages/client/`。CLI 保留 `cmd/xbond/`，Go implementation 在 `internal/`，gomobile 公開入口保留 `mobile/`。新增平台、帳號或購買能力時，從[用戶端體系](docs/architecture/client-system.md)核對責任及跨倉庫契約。

`pnpm check:architecture` 檢查 package 依賴方向、公開 exports 及宿主探測；`pnpm test:client` 可單獨執行共享 client 行為測試。完整的登入、原生支付與 Extension 是各自的後續功能，不由工程歸位推定已支援。
