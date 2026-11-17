# ADR-003：單分支主幹開發與里程碑提交

- **狀態**：已採納（Accepted）
- **日期**：2026-11-18；初版（2026-11-17）曾採 `main` + `dev` 雙分支，執行一日後修訂為單分支，見「背景與問題」
- **關聯領域**：`AGENTS.md`、`docs/specs/branch-and-release-policy.md`、`docs/release.md`、`.github/workflows/`、`scripts/check/check-git-policy.ts`

## 背景與問題

倉庫由單一維護者加 `xbond-automation[bot]` 推進，同時有 Go daemon、React 共用介面、Tauri 桌面與流動殼、原生平台接入及多平台發佈。`main` 需要對應可發佈狀態，歷史需要以里程碑為單位可讀，發佈說明需要面向用戶的短列表。

2026-11-17 初版曾採 `main` + `dev` 雙分支：`dev` 整合、里程碑以 merge commit 合入 `main`。實際執行中，automation 帳號持有 ruleset bypass 權限，直接推送、非 squash 合入與本地 merge 均可落進受保護分支，首個里程碑之後歷史即混入多種進法。對單人 + bot 的節奏，雙分支的儀式成本高於收益，而「規則不是權限」的缺口無法靠文件堵住，故同週修訂為單分支主幹開發。

## 考慮過的方案（Options Considered）

### 方案 A：`main` + `dev` 雙分支，里程碑合入 `main`（初版決策）

- **優勢**：`main` 只保留已驗收里程碑，首父歷史即里程碑；功能 PR 在 `dev` 獨立合入、獨立回滾。
- **劣勢 / 風險**：多一層整合分支需持續綠燈；`main` 允許 merge commit 就不能要求線性；release blocker 需要受控例外與 `main → dev` 回同步；automation bypass 之下門禁形同虛設，實際歷史已混入多種進法。

### 方案 B：完整 GitFlow（`develop`、`release/*`、`hotfix/*`）

- **優勢**：長期維護多個已發佈版本時邊界清楚；hotfix 可以隔離。
- **劣勢 / 風險**：目前只支援最新穩定版，長期 release 分支沒有實際用途；多層分支增加合流、回歸與 cherry-pick 成本，與單人節奏不匹配。

### 方案 C：只保留 `main` 的主幹開發（採納）

- **優勢**：分支最少，整合最快；每個 PR squash 後直接進入可發佈歷史，`main` 全程線性；里程碑邊界由首父上的 `chore(release): X.Y.Z` 發布提交承擔，不依賴 merge commit，初版否決方案 C 的「邊界只能靠 Tag」理由不再成立。
- **劣勢 / 風險**：日常施工與已發佈歷史同幹，未發佈變更直接可見於 `main`，「可發佈」依賴 PR 驗收與 CI 綠燈；候選迭代的試錯提交與功能提交混在同一主幹，靠發布提交分界。

## 決策（Decision）

採方案 C。

1. `main` 是唯一長期分支；`<type>/<slug>` 短期分支從 `main` 開出，PR 一律以 `main` 為 base，squash 合入，一 PR 一提交。
2. 里程碑邊界是 `main` 首父上的 `chore(release): X.Y.Z` 發布提交（版本與五語言更新說明），Tag 只從 `main` 的首父提交建立；歷史仍以里程碑為單位閱讀。
3. 版本採嚴格 SemVer；只支援最新穩定版；已推送或公開的 Tag 不可移動、刪除或重用。
4. 每個版本的更新說明放在 `docs/releases/<version>/<locale>.md`，按語言分檔；五個語言檔案都必要。發佈流程直接讀取目錄，真實 Tag 缺少任何一個語言即失敗。
5. 已發佈穩定版的阻塞缺陷走 release blocker 例外：`fix/release-<version>-<slug>` 對 `main` 開 PR 修復，升 patch 版本重走定版與發佈；例外不得夾帶功能。
6. 提交訊息與分支關係由 commit-msg hook、CI `Policy` 檢查及 `main` ruleset 共同把關；所有 GitHub PR、merge、dispatch 與 release 由 `xbond-automation[bot]` 執行，`Policy` 拒絕其他 PR 作者與 hydrz 的作者／committer 身份。automation 帳號的 bypass 只用於發佈與倉庫自動化；門禁未生效時不宣稱已受保護。

## 後果與取捨（Consequences）

- **正面影響**：`main` 線性，首父歷史即「一 PR 一提交 + 里程碑提交」；沒有 `dev → main` 合併氣泡，也沒有 blocker 回同步動作；更新說明由人撰寫而非機器堆疊。
- **負面代價 / 約束**：`main` 同時承載施工與發佈歷史，未發佈變更合入後即公開可見；「隨時可發佈」依賴每次 PR 的驗收紀律，沒有 `dev` 作為緩衝。
- **後續硬性規定**：CI 必須覆蓋 `main` 的 push 與 PR，並執行 `Policy`、`Web`、`Go`；`main` 禁止 force-push、直接推送與刪除，只接受 squash；Tag 必須位於 `main` first-parent 且不可重用；版本檔案與 `docs/releases/<version>/` 必須同步；偏離政策需先記錄並取得授權。
