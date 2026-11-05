# XBond 發佈手冊

一次正式發佈以 `vX.Y.Z` 和一個已在遠端 `main` 的提交為準。維護者推送 Tag 後，Actions 會準備產物及建立 GitHub Release 草稿。待 iOS、Chrome 和 Edge 的同版已可安裝，才執行公開工作流。公開順序是 GHCR 鏡像、GitHub Release、GitHub Pages 和更新入口。

| 要做的事 | Actions 工作流 | 完成時會看到 |
| --- | --- | --- |
| 驗證發佈矩陣 | **Prepare XBond release**，勾選 `rehearsal` | Actions 有驗證過的候選產物，沒有 Release 草稿 |
| 暫存正式版 | 推送 Tag 觸發 **Prepare XBond release** | GitHub 有草稿，Actions 保留該次的 IPA 和 OCI 鏡像 |
| 提交商店 | **XBond store operations** 或首次上架的商店後台 | 三個商店都能安裝指定版本 |
| 對外公開 | **Publish XBond release** | 鏡像可匿名讀取，Release 已公開，Pages 提供同版下載與更新清單 |

## 1. 確認發佈環境

在 [GitHub Actions](https://github.com/openxbond/xbond/actions) 確認上述三條工作流可從遠端 `main` 執行。以下操作用有相應倉庫或組織權限的 GitHub 身份執行。範例命令使用 PowerShell。

首次設定或輪換憑據時，從組織的 `openxbond/automation` 倉庫執行 `pnpm release-setup`，再對照下表補齊本次需要的設定。環境的 Secrets 輸入私密內容，Variables 放公開資料及識別碼。

| 位置 | 設定 |
| --- | --- |
| Repository Variables | `XBOND_RELEASE_PUBLIC_KEY`（原始 32-byte Ed25519 公鑰的 Base64）、`XBOND_TAURI_PUBLIC_KEY`（Tauri 公鑰檔的內容）、`APPLE_TEAM_ID`。正式公開前補 `APP_STORE_URL`、`CHROME_STORE_URL`、`EDGE_STORE_URL`，填實際商店條目網址。 |
| `release-manifest-signing` | Secret `XBOND_RELEASE_PRIVATE_KEY`，與倉庫公鑰配對的 PKCS#8 PEM。 |
| `release-desktop-signing` | Secrets `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（如有）。macOS 正式簽名另需 `APPLE_CERTIFICATE`（Developer ID Application P12 的 Base64）、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_ID`、`APPLE_PASSWORD`，以及 Variable `APPLE_SIGNING_IDENTITY`。Windows Authenticode 可選用 `WINDOWS_PFX`（Base64）及 `WINDOWS_PFX_PASSWORD`。 |
| `release-android-signing` | Secrets `ANDROID_KEYSTORE_BASE64`、`ANDROID_STORE_PASSWORD`、`ANDROID_KEY_PASSWORD`。Variables `ANDROID_KEY_ALIAS`、`ANDROID_SIGNER_SHA256`（小寫十六進位，無冒號）。每版使用同一發行身份。 |
| `release-ios-signing` | Apple Developer 組織帳號及 App Store profiles，Bundle ID 為 `net.xbond.app` 與 `net.xbond.app.PacketTunnel`。設定 Network Extension 和 App Group `group.net.xbond.app`。Secrets `IOS_DISTRIBUTION_P12`、`IOS_APP_PROFILE`、`IOS_TUNNEL_PROFILE` 用 Base64，另設 `IOS_DISTRIBUTION_PASSWORD`。 |
| `release-store-ios` | Secret `ASC_KEY`（App Store Connect P8 原文），Variables `ASC_KEY_ID`、`ASC_ISSUER_ID`。 |
| `release-store-chrome`、`release-store-edge` | 首次上架使用商店後台。已有條目後才設定 Chrome Secret `CHROME_SERVICE_ACCOUNT` 及 Variables `CHROME_PUBLISHER_ID`、`CHROME_ITEM_ID`，或 Edge Secret `EDGE_API_KEY` 及 Variables `EDGE_CLIENT_ID`、`EDGE_PRODUCT_ID`。 |

確認 Pages 的發佈來源為 GitHub Actions，`v*` Tag 受規則集保護，`release-production` 限 `main` 且需要審核人。首次正式發佈前，在倉庫設定開啟 Release immutability。用管理身份執行下列查詢，確認回傳 `true`。GitHub Release 草稿會先上傳全部資產，再公開。 [GitHub 不可變 Release 設定](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes)

```powershell
gh api repos/openxbond/xbond/immutable-releases --jq '.enabled'
```

## 2. 先演練，確認版本與提交

選擇大於上一個正式版本的 `vX.Y.Z`。每段介於 0–99，禁止前置零，整體版本大於零。CI 把 `X.Y.Z` 注入各端，Android 和 iOS 的 build number 使用 `X × 10000 + Y × 100 + Z`。

在 **Prepare XBond release** 選擇 `main`，輸入擬定的 Tag 並勾選 `rehearsal`。遠端尚未有該 Tag 時，演練使用這次從 `main` 選中的提交。預設以臨時 macOS 程式碼簽名演練並跳過 iOS。Apple 憑據齊備時勾選 `rehearsal_apple_signing`，同時驗證 Developer ID、公證及 App Store 歸檔。Tauri、Android 和發佈清單的簽名材料在兩種演練中都需要配置。

確認 `assemble` 成功、Actions 有 `verified-release`、`release-image`，啟用 Apple 簽名演練時另有 `app-store-build`。下載 `verified-release`，從 `release-evidence.json` 記下提交 SHA、Tag 和 run ID，再核對矩陣與校驗值。

```powershell
$RunId = '<Actions run ID>'
gh run download $RunId -R openxbond/xbond -n verified-release -D release/rehearsal
Get-Content release/rehearsal/release-evidence.json
```

| 產物 | 驗收 |
| --- | --- |
| CLI | Windows、macOS、Linux 各有 amd64／arm64。目標機執行 `xbond version --json` 核對版本與架構。演練舊版升級、拒絕提權、受管服務健康檢查與失敗恢復。 |
| 桌面 | 兩種架構各有 Windows NSIS、macOS DMG、Linux AppImage。安裝後可啟動同版本 daemon。用已簽名的測試來源演練設定頁的檢查、安裝與重啟。 |
| Android | 通用 APK 包含四種 ABI，大小不得超過 512 MiB。核對包名、版本與發行簽名，再用同簽名的舊版實機測試覆蓋安裝及資料保留。 |
| iOS、擴充功能 | Apple 簽名演練檢查 IPA 歸檔，正式草稿階段再經 TestFlight 驗收。Chrome／Edge 先測 MV3 ZIP，正式上架後再從兩個商店驗證安裝。 |
| Dashboard、Docker | 確認 `dashboard.zip` 可解壓使用。用 `release-image` 驗證 Linux amd64／arm64，並確認換版重建容器後 `/data` 資料仍可讀。 |

演練證據帶有 `rehearsal` 標記。演練不部署更新入口，候選客戶端仍以正式 Pages 網址為更新來源。對照舊版的端到端更新需另備隔離測試環境和可驗證的更新來源，不能把打包成功記作升級驗收。

## 3. 推送正式 Tag 並核對草稿

以下命令在演練和必要的實機驗收完成後執行。把範例值換成此次的版本和已驗證提交。若這個版本已存在於本機或遠端，先核對它指向的提交。Tag 一旦推送便以該提交繼續發佈。

```powershell
$ReleaseTag = 'v0.4.3'
$ReleaseCommit = '<已驗證的提交 SHA>'
git fetch origin --tags
git merge-base --is-ancestor $ReleaseCommit origin/main
if ($LASTEXITCODE -ne 0) { throw '提交不在遠端 main 歷史中' }
git tag -a $ReleaseTag $ReleaseCommit -m "XBond $ReleaseTag"
if ($LASTEXITCODE -ne 0) { throw '建立 Tag 失敗' }
git push origin "refs/tags/$ReleaseTag"
```

查看 Tag 觸發的 **Prepare XBond release**。正式 run 必須包含 Apple 簽名。等 `draft` 成功後，核對草稿的 `SHA256SUMS`、`release.json`、`desktop.json`、`release-evidence.json` 及全部平台檔案。`release-evidence.json` 須記錄 `mode: release`、相同 Tag 和提交、OCI digest、IPA SHA-256 及原始 run ID。IPA 和 OCI 只存於該 Actions run，保留期最多 90 天，受倉庫保留上限約束。

## 4. 送商店，等到同版可安裝

- **iOS**：從 `main` 執行 **XBond store operations**，填 Tag，選 `ios` 和 `submit`。工作流驗證原始 IPA 後上傳 App Store Connect。維護者在 TestFlight 驗收，再在 App Store Connect 提交審核並發佈。
- **Chrome 和 Edge**：首發從草稿下載同一份 `xbond-extension-<tag>.zip`，在兩家後台建立條目並送審。已有條目後，可選 `chrome` 或 `edge` 執行 `submit`。用 `status` 查狀態，Edge 另需填入提交日誌中的 `edge_operation_id`。
- **交接給審核人**：實際打開三個公開商店條目並確認可安裝指定版本。記下版本、條目連結和核對結果。API 接收成功、提交進入審核或 TestFlight 可裝，各自是不同狀態。

## 5. 公開並驗證

從 `main` 執行 **Publish XBond release**，`tag` 與 `store_verified_tag` 均填此次 Tag。生產環境審核人核對商店證據、草稿和 Release immutability 設定後批准。

工作流先把已驗證的 OCI 鏡像推到 `ghcr.io/openxbond/xbond:<tag>` 並檢查匿名存取及 digest，再公開 Release 和部署 Pages。GHCR 首推預設為私有。首次執行可能停在匿名讀取檢查，這時到 Package settings 將該套件設為公開，再重跑同一 Tag。 [GHCR 可見性與權限](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)

等 Pages 工作完成。它會比對線上 Dashboard、下載頁、`release.json` 和 `desktop.json` 的內容與已驗證的發佈產物。再確認 GitHub Release 已公開且標示 Immutable，打開 Dashboard 與下載頁，下載一個檔案核對 `SHA256SUMS`。有上一個可更新版本時，用 CLI 或桌面設定頁確認能找到新版本。在發佈記錄貼上正式 Tag、提交、run、Release、鏡像 digest 與商店條目。 [Dashboard](https://openxbond.github.io/xbond/) · [下載頁](https://openxbond.github.io/xbond/download/)

## 失敗時從哪裡重跑

| 當前狀態 | 下一步 |
| --- | --- |
| 演練失敗 | 修復後從最新遠端 `main` 重新演練同一擬定版本，記錄新的提交與 run。 |
| 正式 run 失敗，草稿沒有完整產物 | 先重跑原 run 的失敗工作。草稿上傳會比較已存在的檔案，只補缺失項。若修復需要改 Tag 對應的源碼，用更高版本走一次新流程。 |
| 草稿已送審，IPA 或 OCI artifact 到期 | 從原本保存的已校驗產物處理。若缺少原檔，停止推進這個 Tag，按新版本重建及重新送審。 |
| GHCR 的同名 Tag 已存在 | 若 digest 相同，重跑會沿用。若 digest 不同，停止發佈並核對鏡像來源。 |
| Release 已公開，Pages 失敗 | 檢查線上下載頁及兩個更新清單目前的版本，再重跑同一 Tag 的 **Publish XBond release**。 |
| 已發佈版本有缺陷 | 使用更高版本發佈修正。容器部署可按原 digest 重建，保留 `/data`。CLI、桌面與 Android 的更新入口維持只向更高版本更新。 |

## 用戶端如何更新

- **CLI**：`xbond upgrade --check` 只檢查，`xbond upgrade` 經確認後安裝。`--yes` 跳過 CLI 的確認，系統級服務仍可能要求原生提權。Windows 由 helper 等 CLI 結束後完成替換，留意 helper 的結果。`xbond update` 用於更新訂閱。
- **桌面**：在設定頁檢查及安裝 Tauri 簽名更新。受管 daemon 隨包更新，系統隧道服務有獨立結果。曾用開發版直接註冊 CLI 檔案的系統服務，安排可斷線的時間，由管理員用原安裝來源卸載該 scope，再以新版執行 `xbond daemon install --scope system`。
- **Android、iOS、瀏覽器**：Android 下載簽名 APK 並由系統要求確認。iOS、Chrome 和 Edge 透過原商店更新。
- **Web 與 Docker**：Dashboard 提示重新載入新版。自管 daemon 可解壓 `dashboard.zip` 並指定 `--web-dir`。Docker 拉取指定 Tag 或 digest 並重建，保留 `/data`。
