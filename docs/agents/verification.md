# 驗證矩陣

命令以根 `package.json` 為準。本文件定義應執行甚麼；CI 覆蓋其中的 web 與 Go 門禁（見「自動化現況」），不代表所有平台與能力已自動驗證。

## 選最窄的有效證據

| 變更範圍 | 開發迴圈 | 交付檢查 | 證明不到的部分 |
| --- | --- | --- | --- |
| 純文件／文案 | 本次連結、路徑、命令及事實核對 | `pnpm exec oxfmt --check <files>`、`git diff --check` | 不需要為文件跑全部產品測試 |
| Web 行為、狀態、接口適配 | `node --test <test-file>` | `pnpm check`（typecheck、lint、format、test）、`pnpm build` | Node 測試不是瀏覽器渲染或原生操作 |
| Web 樣式／版面／互動 | 實際頁面、相關行為測試及 UI 分支 | 相關靜態檢查、Web 建置、有界視覺與操作驗證 | Mock、截圖不能證明系統代理及 VPN |
| Go CLI、本機服務、核心、訂閱 | `pnpm cli:test ./<package> -run <TestName>` | `pnpm cli:check`；`pnpm cli:fmt:check` 無輸出 | 目前宿主測試不證明其他作業系統或特權網絡行為 |
| daemon 生命週期與服務託管 | `pnpm cli:daemon` 前景運行＋`xbond service status`；shutdown 端點以行為測試覆蓋 | 目標平台實機跑 `xbond service install`／`stop`／`uninstall` 全周期（Windows 為 HKCU Run 值，Linux 為 systemd --user，macOS 為 LaunchAgent） | HKCU Run 無崩潰重啟監督；開機未登入不自啟；未實機驗證的平台保留待驗證 |
| Tauri Rust、IPC、托盤、服務生命週期 | 相關 Rust／IPC 測試或實際桌面操作 | `pnpm desktop:fmt:check`、`pnpm desktop:check`、`pnpm build:desktop` | cargo check 不是安裝、托盤或服務恢復驗收 |
| `mobile/` Go 接口 | 帶相同 build tags 的 `go test ./mobile/...` | `pnpm mobile:check`；共用 Go 變更另跑 `pnpm cli:check` | 不會構建 AAR、XCFramework 或驗證裝置 VPN |
| Android／iOS 接入 | 對應 SDK 編譯、安裝及相關裝置情境 | Android 綁定可用 `pnpm mobile:bind:android`；iOS 綁定可用 `pnpm mobile:bind:ios`，另加原生工程／裝置驗證 | 綁定成功不等於宿主 App、簽署或 VPN 交付 |
| LocalAPI／跨端契約 | Go 生產者、Web 消費者及相關宿主測試 | 合併本表各受影響層的檢查 | 單側 mock 可能同時重複錯誤契約 |
| 封裝／轉交腳本 | `node --test scripts/artifact.test.ts scripts/transfer.test.ts`（移動腳本另選相應測試） | `pnpm test`、型別／lint、實際本機封裝與驗證 | 測試通過不構成公開發佈授權 |

所有有改動的支援格式檔案另做最窄 Oxfmt 檢查。用實際檔案、套件及測試名稱替換尖括號；測試檔可從 `packages/client/tests/ 或 packages/client-ui/tests/`、`scripts/` 及各 Go 套件選取。Go 的 build tags 單一來源在 `scripts/go.ts`，不要以未帶 tags 的局部綠燈代替交付命令。

## 需要實際運行的邊界

僅在本次涉及的能力上驗證。真實系統代理、TUN、VPN 及服務啟停使用已授權的測試環境，記錄原設定、操作影響與還原確認。

| 邊界 | 最小驗收情境 |
| --- | --- |
| 訂閱／配置 | 首次加入、更新成功、非法／超時更新保留已知良好狀態、刪除及重啟後資料 |
| LocalAPI／控制器 | 憑證有效／無效、目標切換、超時／斷線、狀態未知、不支援能力的入口 |
| 核心與流量接管 | 啟動／停止／失敗回報；核心運行、流量接管、外部連通逐項核實 |
| 桌面殼 | 啟動、單實例、關窗／托盤、服務斷開及恢復；按本次變更選情境 |
| 原生 VPN | 系統授權、撤銷、啟停、網絡切換與背景／前景；標明真機或模擬器 |
| UI | 桌面／手機、明暗、鍵盤、減少動態、長文案與相關錯誤／空狀態 |

## 證據格式

每項結果記錄：命令或操作、日期／環境、結果、證明的驗收條件及限制。自動化以退出碼和測試摘要為準；人工操作記具體情境與觀察。截圖需有目標頁、尺寸、主題及資料來源。

既有失敗先與基線核對；新增失敗先修復。工具鏈缺失或平台不可用就標為未執行並指出具體缺口，不能填「通過」。有關驗收仍未通過時，任務保留待驗證，不把未驗證平台列為已支援。

## 自動化現況

`.github/workflows/` 在 push 與 PR 複用本地同一批命令：`ci.yml` 的 `web` job 跑 `pnpm check` 與 `pnpm build` 並校驗產物非空，`go` job 跑 `pnpm cli:check`；`desktop-check.yml` 僅在 `apps/desktop/src-tauri/` 等路徑變更時跑 `pnpm build:desktop`、`pnpm desktop:fmt:check`、`pnpm desktop:check`（runner 缺少的系統依賴在 workflow 內安裝）。pre-commit（lefthook，`pnpm hooks:install` 自選安裝）對提交中的檔案跑同樣的 oxfmt 與 oxlint 檢查。檢查成為合併門禁須在 GitHub 儲存庫設定中設為 required checks；runner 工具鏈或平台依賴缺失造成的失敗先與基線核對，不能以本地綠燈掩蓋。
