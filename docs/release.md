# XBond 發佈手冊

一次發佈只用一個 `vX.Y.Z`。**推 Tag → 驗收安裝 → 批准公開。** iOS 首發透過 TestFlight 安裝，App Store 可之後上架。

## 產物目錄

日常建置用 `dist/`。`pnpm build` 產出 `dist/web/`，`pnpm build:desktop` 產出 `dist/desktop/`，`pnpm cli:build` 產出 `dist/cli/xbond`（Windows 為 `xbond.exe`）。`pnpm desktop:compile` 編譯本機桌面執行檔，封裝安裝包使用 `pnpm release:desktop`。

發佈候選以 `release/<tag>/` 為根目錄。下列路徑使用 `v0.4.3` 作例子。

| 目錄 | 產物 |
| --- | --- |
| `web/`、`core/` | `pnpm release:build v0.4.3` 產出網頁、`dashboard.zip`、`SHA256SUMS`，以及 Windows、macOS 和 Linux 各兩個架構的獨立 CLI，例如 `xbond-v0.4.3-windows-amd64.exe`。 |
| `desktop/<os>-<arch>/` | Windows 為 NSIS `.exe`、macOS 為 `.dmg`、Linux 提供 `.deb`、`.rpm` 和 `.AppImage`，例如 `xbond-desktop-v0.4.3-linux-arm64.AppImage`。Windows NSIS 及 Linux AppImage 隨附自動更新用的 `.sig`，macOS 另外產生自動更新用的 `.app.tar.gz` 及其簽名。 |
| `android/` | 以 Android SDK Build-Tools 36.0.0 簽名並校驗應用 ID、版本及簽名指紋的通用 APK `xbond-android-v0.4.3.apk`。 |
| `ios/` | App Store Connect 用的 `xbond-ios-v0.4.3.ipa`，經 TestFlight 或 App Store 安裝。 |
| `oci/` | `xbond-oci-v0.4.3.tar`，含 Linux amd64 和 arm64 鏡像。 |
| `assets/`、`pages/` | GitHub Release 的平鋪資產、簽名清單與 `SHA256SUMS`，以及從同批資產產生的 Pages 網站。 |

本機可先跑 `pnpm release:build v0.4.3`。有目標平台工具鏈及簽名材料時，再在相應宿主跑 `pnpm release:desktop v0.4.3 linux amd64`（按宿主換成 `windows`、`darwin` 或 `linux`，架構用 `amd64` 或 `arm64`）。桌面封裝從同版 `core/` 取出 daemon。Tauri、Gradle 及 Xcode 的原生中間檔由各自工具管理。

Tauri 在 `tauri.<platform>.conf.json` 選擇平台的安裝包格式，桌面發佈再疊加 `tauri.release.conf.json` 啟用 daemon sidecar 及更新產物。封裝指令帶入本次版本及簽名設定。

Linux 在 Debian／Ubuntu 可用 `sudo apt install ./xbond-desktop-v0.4.3-linux-amd64.deb`，在 Fedora 可用 `sudo dnf install ./xbond-desktop-v0.4.3-linux-amd64.rpm`。請選擇本機架構對應的檔案。更新這兩種套件時，使用相同命令安裝新版。

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

**Prepare XBond release** 由推 Tag 觸發，依序是 preflight（版本、模式與 Apple 簽名旗標單點派生）、check（TS 與 Go 門禁）、cli（CLI 六目標編譯與 dashboard 打包），其後六個桌面目標、Android、iOS與 OCI 鏡像並行建置，最後 assemble 匯整為一份帶 evidence 的候選並寫入草稿。等 `draft` 成功，從該 run 的摘要進入 Release 草稿，再使用草稿的安裝包及同一 run 的 IPA、OCI 鏡像。提交 SHA、run ID 和兩份摘要可在 `release-evidence.json` 核對。

桌面與移動端共用根目錄的 Tauri 專案。Android 工作流執行 `pnpm mobile:bind:android` 和 `pnpm tauri android build --apk`，再用發行金鑰簽署通用 APK。iOS 工作流執行 `pnpm mobile:bind:ios`，透過 `pnpm tauri ios build --archive-only` 歸檔主程式及 PacketTunnel，再以兩份 provisioning profiles 匯出 IPA。

## 2. 驗收同版產物

| 平台 | 安裝與驗收 |
| --- | --- |
| CLI、桌面 | Windows、macOS、Linux 各驗證 amd64 和 arm64 安裝包或獨立二進位。核對 `xbond version --json`，驗證桌面與隨附 daemon 啟動，並在受控環境測試覆蓋安裝、升級及服務失敗恢復。 |
| Android | 安裝簽名 APK，核對版本並驗證 VPN。用同簽名的舊版測試覆蓋安裝和資料保留。 |
| iOS | 從 `main` 執行 **XBond store operations**，填同一 Tag、`store=ios`、`operation=submit`。工作流上傳已校驗的 IPA。在 App Store Connect 把該 build 加入 TestFlight 內部測試群組，實機安裝並驗證隧道、斷線和重連。 |
| Dashboard、Docker | 解壓 `dashboard.zip` 驗證頁面。用候選 OCI 鏡像驗證 Linux amd64 和 arm64，重建容器後確認 `/data` 持續可讀。 |

TestFlight 內部測試需要 Apple Developer 簽名與 App Store Connect 帳號。外部測試可另設邀請連結，首次外部 build 需經 Beta 審核。 [Apple TestFlight](https://developer.apple.com/testflight/)

## 3. 批准公開

從 `main` 執行 **Publish XBond release**，填 `tag`，確認上表後勾選 `install_verified`。由 `release-production` 審核人核對同一候選和驗收記錄後批准。工作流發佈 GHCR、公開 GitHub Release、部署 Pages，並逐項比對線上的頁面與兩份更新清單。

完成後打開下載頁，下載一個產物比對 `SHA256SUMS`。已有公開舊版時，再用 `xbond upgrade --check` 和桌面設定頁確認能找到新版本。 [下載頁](https://openxbond.github.io/xbond/download/)

## 首次設定

按組織的 `openxbond/automation` 倉庫 README 將 Apple 及商店材料放入 Git 忽略的 `release-private/`，再在該倉庫執行 `pnpm release-setup` 和 `pnpm release-setup --check`。下表供查找 GitHub 欄位。 [Automation 設定](https://github.com/openxbond/automation#發佈密鑰與-xbond-設定)

| 位置 | 設定 |
| --- | --- |
| Repository Variables | `XBOND_RELEASE_PUBLIC_KEY`（32-byte Ed25519 公鑰的 Base64）、`XBOND_TAURI_PUBLIC_KEY`（Tauri 公鑰檔內容）、`APPLE_TEAM_ID`。有可用條目後才填 `APP_STORE_URL`。有可用的 TestFlight 公開邀請時可填 `IOS_TESTFLIGHT_URL`。 |
| `release-manifest-signing` | Secret `XBOND_RELEASE_PRIVATE_KEY`（配對的 PKCS#8 PEM）。 |
| `release-desktop-signing` | Secrets `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（如有）。macOS 另需 `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY` 及 Apple 團隊 API Key `ASC_KEY`。公證與 TestFlight 共用 Repository Variables `ASC_KEY_ID`、`ASC_ISSUER_ID`。Windows 可配置 `WINDOWS_PFX` 及 `WINDOWS_PFX_PASSWORD`。配置後，CI 在上傳前驗證 Authenticode 簽名及簽署憑證指紋。憑證未配置時，CI 會標示安裝包缺少 Authenticode 簽名。 |
| `release-android-signing` | Secrets `ANDROID_KEYSTORE_BASE64`、`ANDROID_STORE_PASSWORD`。若金鑰密碼與 keystore 密碼不同，設定 `ANDROID_KEY_PASSWORD_OVERRIDE`。Variables `ANDROID_KEY_ALIAS`、`ANDROID_SIGNER_SHA256`（小寫十六進位，無冒號）。後續更新沿用同一簽名身份。 |
| `release-ios-signing` | Apple Developer 組織帳號。為 `net.xbond.app` 和 `net.xbond.app.PacketTunnel` 建立 App Store Connect 發行用 profiles，配置 Network Extension 及 App Group `group.net.xbond.app`。Secrets `IOS_DISTRIBUTION_P12`、`IOS_APP_PROFILE`、`IOS_TUNNEL_PROFILE` 用 Base64，另設 `IOS_DISTRIBUTION_PASSWORD`。 |
| `release-store-ios` | Secret `ASC_KEY`（App Store Connect P8 原文），Variables `ASC_KEY_ID`、`ASC_ISSUER_ID`。 |

設定指令會建立必要環境、配置 Pages 使用 GitHub Actions、啟用不可變 Release，並保留現有的 `v*` Tag 保護與 `release-production` 審核人。 [GitHub 不可變 Release](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes)

## 演練與故障恢復

- **演練**：從 `main` 手動執行 **Prepare XBond release**，勾選 `rehearsal` 並填擬定版本。預設以臨時 macOS 簽名演練並跳過 iOS 歸檔。Apple 憑據齊備時可勾選 `rehearsal_apple_signing`。演練只產生 Actions artifacts。
- **準備失敗**：重跑原 run 的失敗工作。草稿已收到的檔案會核對後沿用。要改源碼則用更高版本。IPA 和 OCI artifacts 最多保留 90 天，送審或公開前保留原始已校驗檔案。
- **GHCR 或 Pages 失敗**：重跑同一 Tag 的公開工作流。GHCR 首推若套件是私有，先在 Package settings 設為公開。同 Tag 已有不同 digest 時先停止並查明原因。Pages 失敗時先核對目前在線的版本。 [GHCR 套件可見性](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
- **已公開版本需要修正**：用更高版本發佈修正。Docker 可改用原 digest 重建，保留 `/data`。

## 商店上架與更新

沿用公開版的同一個 Tag 和產物。iOS 在 App Store Connect 選擇已驗證的 TestFlight build 提交 App Store 審核。

上架後核對安裝與登入，再填 App Store 的 URL。重跑當前正式 Tag 的 **Publish XBond release** 即可更新下載頁，既有 GitHub Release 和 GHCR 鏡像按摘要沿用。

CLI 用 `xbond upgrade --check` 檢查、`xbond upgrade` 安裝，`--yes` 跳過 CLI 確認，系統級服務仍可能要求原生提權。桌面在設定頁更新，Android 用應用內入口與系統安裝器。iOS 測試版由 TestFlight 更新。商店版由原商店更新。
