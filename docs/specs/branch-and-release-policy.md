# 分支、提交與版本政策

本文件是倉庫的長期工程政策，配套 [ADR-003](../adr/003-branch-and-release-policy.md)。工作入口與驗證方式見[開發管線](dev-pipeline.md)，發佈操作與簽名細節見[發佈手冊](../release.md)。兩者與本政策衝突時，先修正文件再施工，不以現有腳本或習慣追認政策。

## 範圍與目標

- 適用於本倉庫所有功能、修復、文件、建置與發佈變更；Cloud 控制面在另一倉庫，另行制定。
- `main` 是唯一長期分支，永遠對應一個可發佈或已發佈的狀態；「可發佈」由每次 PR 的驗收與 CI 綠燈維持，沒有整合分支作緩衝。
- 歷史以里程碑為單位，更新說明以用戶可讀的短列表為單位，兩者不混為一談。
- 目前只支援最新穩定版，不維護舊版本分支；需要長期支援時另立 ADR，不臨時加分支。

## 分支模型

| 分支 | 角色 | 生命週期 | 合入方式 |
| --- | --- | --- | --- |
| `main` | 日常施工與已發佈歷史同幹；首父上的 `chore(release): X.Y.Z` 發布提交即里程碑邊界 | 長期 | 只接受 PR squash，保持線性 |
| `<type>/<slug>` | 單一變更的短期分支，從 `main` 開出 | 不超過 2 個工作日 | rebase 到最新 `main` 後經 PR squash 合入 |

- 短期分支類型沿用 conventional 前綴：`feat`、`fix`、`perf`、`refactor`、`docs`、`test`、`style`、`build`、`ci`、`chore`、`revert`；`<slug>` 用小寫字母、數字、連字符與點號（版本號需要點號，如 `release-1.0.1`）。
- 分支合入後即刪除，不在遠端保留已完成分支。
- 不建立長期 `develop`、`dev`、`release/X.Y` 或 `hotfix` 分支；`main` 就是唯一的整合與發佈分支。
- 允許在短期分支上 rebase、amend、force-push；`main` 禁止 force-push 與刪除。

## 提交與 PR

### 提交格式

- 採 Conventional Commits：`type(scope): 描述`；`type` 與 `scope` 用英文，描述用英文（祈使語氣），技術名稱保留原文。
- 允許的 `type`：`feat`、`fix`、`perf`、`refactor`、`docs`、`test`、`style`、`build`、`ci`、`chore`、`revert`。
- `scope` 可省略；使用時從固定清單選：`daemon`、`engine`、`sub`、`client`、`client-ui`、`desktop`、`mobile`、`android`、`ios`、`release`、`docker`、`telemetry`、`connect`、`proxies`、`settings`、`logs`、`auth`、`repo`、`docs`、`ci`、`build`。
- 標題不超過 100 個字元，描述必須是英文且不得含中文字，結尾不加句號；不使用全形冒號分隔 type 與描述。
- 一個提交只做一件事，不使用複合標題（例如同時寫兩個 `feat:`）。修正鏈在合入前 squash 成一個提交。
- 破壞性變更在 type／scope 後加 `!`，並在正文寫 `BREAKING CHANGE:` 與遷移方式。
- 正文按需要寫動機、影響、驗證與限制；不寫逐字會話紀錄、不貼無關日誌、不加簽名檔。
- 不使用 `wip`、`tmp`、`fixup`、`squash!` 等臨時標題進入 `main`。
- 提交訊息由 commit-msg hook 與 CI 的 `Policy` 檢查共同校驗；本機 hook 未安裝時，CI 仍會阻擋不合格的 PR 標題與分支。

### PR 規則

- PR 標題就是 squash 後的提交標題，必須符合上述格式；標題不合格不應合入。PR 必須由 `xbond-automation[bot]` 開啟，個人帳號不用於建立、審查或合併 PR。
- PR 正文至少包含：目的與影響、驗證命令與實際結果、任務或規格連結、風險與回退方式。
- 所有 PR 一律以 `main` 為 base，squash 合入，一 PR 一提交。
- 發布提交從 `chore/release-X.Y.Z` 分支以 PR 合入 `main`，標題為 `chore(release): X.Y.Z`；該提交即里程碑邊界。
- 合入前必須通過 `pnpm check`；涉及 Go、原生殼或平台能力時，再按[驗證矩陣](../agents/verification.md)跑對應檢查。CI 綠燈不能代替目標平台驗收。

## 里程碑

里程碑是一個版本範圍內的全部已驗收工作，不是一個時間段或一組隨意提交。里程碑邊界是 `main` 首父上的 `chore(release): X.Y.Z` 發布提交。

### 進入 `main` 的條件

1. PR 已通過 `Policy`、`Web`、`Go` 等必要檢查。
2. 使用者可觀察的驗收已完成，證據記在任務或 PR；平台限制如實標明。
3. 發布提交隨附：版本已在 `package.json` 更新，並用 `pnpm version:set <x.y.z>` 同步其餘來源；`pnpm check:version` 通過。
4. 發布提交隨附：`docs/releases/<version>/` 已包含齊全的語言更新說明（見下節）。
5. 沒有未處理的 release blocker；未完成項已移出本次里程碑。

### 更新說明

- 每個版本一個 `docs/releases/<version>/` 目錄，`<version>` 不帶 `v`、不帶 `-rc.N`；RC 與穩定版共用同一份基線說明。
- 語言分檔，檔名用 i18n 的 locale code：`zh-hk.md`、`en-us.md`、`zh-cn.md`、`ko.md`、`fa.md`。每個檔案只寫該語言，不混排其他語言。
- 五個語言檔案都必要：`zh-hk.md`、`en-us.md`、`zh-cn.md`、`ko.md`、`fa.md`；缺一即視為未完成，不以其他語言代替。
- 內容面向用戶，只寫 3–6 條可感知的變化：新增能力、行為改進、修復、升級須知。不寫內部重構、依賴升級或提交清單。
- 破壞性變更必須在各語言檔案中明寫影響與遷移方式，不能只靠提交標題的 `!`。
- 發佈流程讀取整個目錄，按 `zh-hk`、`en-us`、`zh-cn`、`ko`、`fa` 順序生成多語言段落；真實 Tag 缺少任何一個語言時 preflight 失敗，演練才允許回退到 conventional 提交彙總。
- 更新說明在 PR 中一併審閱；候選版發現需要補充時，用新的修復提交更新同一目錄，不改已公開的 Tag。

## 版本與 Tag

### 版本規則

- 採嚴格 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-TW/)：破壞性變更升 major，向後兼容的新功能升 minor，向後兼容的修復升 patch。
- 對外兼容邊界包括 CLI 參數與 JSON 輸出、LocalAPI 端點與欄位、配置與訂閱格式、deep link 契約、更新清單與簽名格式、持久化資料。改動這些邊界即按破壞性變更處理。
- 檔案版本只在 `package.json` 維護；`pnpm version:set` 同步 Tauri、Cargo、iOS、Android、Go 與前端回退；`pnpm check:version` 校驗一致。
- 候選號只存在於 Tag（`vX.Y.Z-rc.N`），不寫進檔案版本；穩定版為 `vX.Y.Z`。版本排序、構建號與平台限制以[發佈手冊](../release.md#版本與-tag)為準。

### Tag 規則

- Tag 只從 `main` 的首父提交建立，且該提交必須是 `chore(release): X.Y.Z` 發布提交、其後的候選迭代修復或 release blocker 修復。
- 使用 annotated tag；Tag 名必須與 `package.json` 及 `docs/releases/<version>/` 的版本一致。
- 已推送或已公開的 Tag 不可移動、刪除或重用；修正一律升 `rc.N` 或 patch 版本。
- RC 不進入穩定更新清單、不推 `latest`；穩定版公開後才更新 Pages、更新清單與容器標籤。

## 發佈流程

1. **整合**：功能與修復經 PR squash 進入 `main`；`main` 保持可建置與 CI 綠燈。
2. **定版準備**：從 `main` 開 `chore/release-X.Y.Z`，執行 `pnpm version:set X.Y.Z`，新增或更新 `docs/releases/X.Y.Z/` 的各語言檔案，PR 以標題 `chore(release): X.Y.Z` squash 合入 `main`；合入後 `main` 首父提交即本次里程碑邊界。
3. **候選驗收**：在該發布提交（或候選迭代修復後的 `main` 末端提交）建立 `vX.Y.Z-rc.N` annotated tag 並推送，執行 **Prepare XBond release**；按發佈手冊驗收同一 run 的產物。發現問題則正常 PR 修復進 `main`，之後直接在 `main` 末端升 `rc.N` 重切候選。
4. **穩定發佈**：候選驗收通過後在 `main` 末端建立 `vX.Y.Z` tag，執行 **Publish XBond release**；只有穩定版更新穩定清單、Pages 與 `latest`。
5. **Patch**：已發佈穩定版的阻塞缺陷可走 release blocker 例外；修正後升 patch 版本，重複定版準備與發佈步驟。

## 例外：Release Blocker

- 只適用於已發佈穩定版的阻塞缺陷，例如無法啟動、無法連線、資料損壞或安全問題；不得夾帶功能或重構。
- 從 `main` 開 `fix/release-<version>-<slug>`，PR 以 `main` 為 base，squash 合入；隨後以 `chore/release-<patch>` 發布提交更新 `docs/releases/<patch>/` 與版本，建立 patch Tag。
- 修復合入後無需回同步動作：`main` 就是唯一主幹，不存在第二分支的重複或覆蓋。
- 每次例外都要在 PR 或任務記錄原因、影響版本與回歸結果；例外不是常態通道。

## 自動化與保護

- CI 在 PR 與 push 到 `main` 時執行 Web 與 Go 檢查；桌面檢查按路徑觸發。發佈工作流只由 Tag 或手動觸發。
- 所有到 `main` 的 PR 必須通過 `Policy` 檢查：提交標題格式、允許的 type／scope、英文描述、base／head 分支關係，以及發布提交的 `chore/release-X.Y.Z` 標題例外。
- PR 作者必須是 `xbond-automation[bot]`；`Policy` 同時掃描 PR 內提交的作者與 committer，發現 `Hydrz D` 或 `n.haoyuan@gmail.com` 即失敗。
- 規則不是權限：repo／org admin 仍可修改 ruleset 或 workflow。要硬性禁止個人帳號，必須移除其 write／admin，只保留 automation App 與另一個受控管理員。
- `pnpm hooks:install` 安裝 lefthook 的 pre-commit 與 commit-msg hook；commit-msg 使用同一套提交規則，讓不合格訊息在本機就被攔下。
- `main`：要求 PR、禁止直接推送與 force-push、禁止刪除；要求線性歷史，只接受 squash。
- 必要檢查為 `Policy`、`Web`、`Go`；桌面檢查因路徑過濾，不作必要檢查。
- 發佈 preflight 檢查 Tag 是否位於 `main` 的 first-parent 歷史、Tag 基線版本是否等於該提交的 `package.json` 版本，並在真實 Tag 要求 `docs/releases/<version>/` 具備全部五個語言檔案。
- `v*` Tag 的建立與變更受保護，只由發佈流程操作。
- 自動化帳號的 bypass 只用於發佈與倉庫自動化；一般變更不得以管理員權限繞過 PR 與檢查。沒有 ruleset 或必要檢查的證據，不宣稱門禁已生效。

## 偏離與修正

- 需要偏離本政策時，先在手頭任務記錄原因、影響與恢復方式，取得明確授權後才執行；不得以「這次先這樣」長期繞過。
- 政策與實際流程不一致時，先判斷是政策過期、工具缺失還是人為繞過；修正正確的一方，並同步 `AGENTS.md`、開發管線與發佈手冊的入口與命令。
- 每次調整分支模型、合併方式、版本規則或支援範圍，修訂對應 ADR，保留原有結論的修訂軌跡。
