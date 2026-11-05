# XBond 發佈手冊

一次發佈只用一個 `vX.Y.Z`。**推 Tag → 驗收安裝 → 批准公開。** iOS 首發透過 TestFlight 安裝，Chrome 和 Edge 使用擴充功能 ZIP。App Store、Chrome Web Store 與 Edge Add-ons 可之後上架。

## 1. 推 Tag

選擇遠端 `main` 上已通過 CI 的提交。版本高於上一個正式版，三段各為 0–99、無前置零，整體大於零。

```powershell
$ReleaseTag = 'v0.4.3' # 換成本次版本
git fetch origin --tags
if ($LASTEXITCODE -ne 0) { throw '讀取遠端失敗' }
git tag -a $ReleaseTag origin/main -m "XBond $ReleaseTag"
if ($LASTEXITCODE -ne 0) { throw '建立 Tag 失敗' }
git push origin "refs/tags/$ReleaseTag"
```

**Prepare XBond release** 由推 Tag 觸發。等 `draft` 成功，從該 run 的摘要進入 Release 草稿，再使用草稿的安裝包及同一 run 的 IPA、OCI 鏡像。提交 SHA、run ID 和兩份摘要可在 `release-evidence.json` 核對。

## 2. 驗收同版產物

| 平台 | 安裝與驗收 |
| --- | --- |
| CLI、桌面 | Windows、macOS、Linux 各驗證 amd64 和 arm64 安裝包或獨立二進位。核對 `xbond version --json`，驗證桌面與隨附 daemon 啟動，並在受控環境測試覆蓋安裝、升級及服務失敗恢復。 |
| Android | 安裝簽名 APK，核對版本並驗證 VPN。用同簽名的舊版測試覆蓋安裝和資料保留。 |
| iOS | 從 `main` 執行 **XBond store operations**，填同一 Tag、`store=ios`、`operation=submit`。工作流上傳已校驗的 IPA。在 App Store Connect 把該 build 加入 TestFlight 內部測試群組，實機安裝並驗證隧道、斷線和重連。 |
| Chrome、Edge | 解壓草稿的 `xbond-extension-<tag>.zip`，在 `chrome://extensions` 和 `edge://extensions` 開啟開發者模式，用「載入未封裝項目」選含 `manifest.json` 的目錄。兩個瀏覽器都要實測安裝。 |
| Dashboard、Docker | 解壓 `dashboard.zip` 驗證頁面。用候選 OCI 鏡像驗證 Linux amd64 和 arm64，重建容器後確認 `/data` 持續可讀。 |

TestFlight 內部測試需要 Apple Developer 簽名與 App Store Connect 帳號。外部測試可另設邀請連結，首次外部 build 需經 Beta 審核。 [Apple TestFlight](https://developer.apple.com/testflight/) · [Chrome 本機安裝](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)

## 3. 批准公開

從 `main` 執行 **Publish XBond release**，填 `tag`，確認上表後勾選 `install_verified`。由 `release-production` 審核人核對同一候選和驗收記錄後批准。工作流發佈 GHCR、公開 GitHub Release、部署 Pages，並逐項比對線上的頁面與兩份更新清單。

完成後打開下載頁，下載一個產物比對 `SHA256SUMS`。已有公開舊版時，再用 `xbond upgrade --check` 和桌面設定頁確認能找到新版本。 [下載頁](https://openxbond.github.io/xbond/download/)

## 首次設定

從組織的 `openxbond/automation` 倉庫執行 `pnpm release-setup`，再補齊當次所需的設定。Secrets 放私密內容，Variables 放公鑰、網址和識別碼。

| 位置 | 設定 |
| --- | --- |
| Repository Variables | `XBOND_RELEASE_PUBLIC_KEY`（32-byte Ed25519 公鑰的 Base64）、`XBOND_TAURI_PUBLIC_KEY`（Tauri 公鑰檔內容）、`APPLE_TEAM_ID`。有可用條目後才填 `APP_STORE_URL`、`CHROME_STORE_URL`、`EDGE_STORE_URL`。有可用的 TestFlight 公開邀請時可填 `IOS_TESTFLIGHT_URL`。 |
| `release-manifest-signing` | Secret `XBOND_RELEASE_PRIVATE_KEY`（配對的 PKCS#8 PEM）。 |
| `release-desktop-signing` | Secrets `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（如有）。macOS 另需 `APPLE_CERTIFICATE`（Developer ID Application P12 的 Base64）、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_ID`、`APPLE_PASSWORD`，以及 Variable `APPLE_SIGNING_IDENTITY`。Windows Authenticode 可用 `WINDOWS_PFX` 和 `WINDOWS_PFX_PASSWORD`。 |
| `release-android-signing` | Secrets `ANDROID_KEYSTORE_BASE64`、`ANDROID_STORE_PASSWORD`、`ANDROID_KEY_PASSWORD`。Variables `ANDROID_KEY_ALIAS`、`ANDROID_SIGNER_SHA256`（小寫十六進位，無冒號）。後續更新沿用同一簽名身份。 |
| `release-ios-signing` | Apple Developer 組織帳號。為 `net.xbond.app` 和 `net.xbond.app.PacketTunnel` 建立 App Store Connect 發行用 profiles，配置 Network Extension 及 App Group `group.net.xbond.app`。Secrets `IOS_DISTRIBUTION_P12`、`IOS_APP_PROFILE`、`IOS_TUNNEL_PROFILE` 用 Base64，另設 `IOS_DISTRIBUTION_PASSWORD`。 |
| `release-store-ios` | Secret `ASC_KEY`（App Store Connect P8 原文），Variables `ASC_KEY_ID`、`ASC_ISSUER_ID`。 |

確認 Pages 的 Source 為 GitHub Actions，`v*` 受 Tag 規則集保護，`release-production` 限 `main` 且需要審核人。管理者在正式發佈前開啟 Release immutability。 [GitHub 不可變 Release](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes)

## 演練與故障恢復

- **演練**：從 `main` 手動執行 **Prepare XBond release**，勾選 `rehearsal` 並填擬定版本。預設以臨時 macOS 簽名演練並跳過 iOS 歸檔。Apple 憑據齊備時可勾選 `rehearsal_apple_signing`。演練只產生 Actions artifacts。
- **準備失敗**：重跑原 run 的失敗工作。草稿已收到的檔案會核對後沿用。要改源碼則用更高版本。IPA 和 OCI artifacts 最多保留 90 天，送審或公開前保留原始已校驗檔案。
- **GHCR 或 Pages 失敗**：重跑同一 Tag 的公開工作流。GHCR 首推若套件是私有，先在 Package settings 設為公開。同 Tag 已有不同 digest 時先停止並查明原因。Pages 失敗時先核對目前在線的版本。 [GHCR 套件可見性](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
- **已公開版本需要修正**：用更高版本發佈修正。Docker 可改用原 digest 重建，保留 `/data`。

## 商店上架與更新

沿用公開版的同一個 Tag 和產物。iOS 在 App Store Connect 選擇已驗證的 TestFlight build 提交 App Store 審核。Chrome 和 Edge 首次在各自後台提交同版 ZIP。已有條目後，可用 **XBond store operations** 的 `submit` 或 `status`，Edge 查詢需 `edge_operation_id`。Chrome API 需 `CHROME_SERVICE_ACCOUNT`、`CHROME_PUBLISHER_ID`、`CHROME_ITEM_ID`，Edge API 需 `EDGE_API_KEY`、`EDGE_CLIENT_ID`、`EDGE_PRODUCT_ID`。

商店上架後，核對條目確實可安裝，再填該商店的 URL。重跑當前正式 Tag 的 **Publish XBond release** 即可更新下載頁，既有 GitHub Release 和 GHCR 鏡像按摘要沿用。

CLI 用 `xbond upgrade --check` 檢查、`xbond upgrade` 安裝，`--yes` 跳過 CLI 確認，系統級服務仍可能要求原生提權。桌面在設定頁更新，Android 用應用內入口與系統安裝器。iOS 測試版由 TestFlight 更新，解壓安裝的擴充功能用新版 ZIP 替換並重新載入。商店版由原商店更新。
