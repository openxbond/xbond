# XBond 發佈手冊

一次發佈只用一個 `vX.Y.Z`。**推 Tag → 驗收安裝 → 批准公開。** iOS 首發透過 TestFlight 安裝，App Store 可之後上架。

## 建置入口與產物

在倉庫根目錄執行 `package.json` 的命令。Tauri 負責編譯原生殼及封裝，XBond 腳本負責準備 Go daemon 或 gomobile 綁定，以及發佈版本、簽名和產物整理。

| 用途 | 命令 | 產物 |
| --- | --- | --- |
| 編譯 Web | `pnpm build` | `dist/web/` |
| 編譯本機 CLI | `pnpm cli:build` | `dist/cli/xbond`，Windows 為 `xbond.exe` |
| 編譯桌面程式 | `pnpm build:desktop` | `dist/desktop/` 前端資源及 Cargo release 執行檔 |
| 本機桌面安裝包 | `pnpm package:desktop` | Tauri 的 `<Cargo target>/local/<Rust triple>/release/bundle/` |
| Android debug APK | `pnpm package:android [target]` | `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk` |
| Web 與 CLI 發佈候選 | `pnpm release:core <tag>` | `release/<tag>/web/` 及 `release/<tag>/core/` |
| 桌面發佈候選 | `pnpm release:desktop <tag> <os> <arch>` | `release/<tag>/desktop/<os>-<arch>/` |
| Android 發佈候選 | `pnpm release:android <tag>` | `release/<tag>/android/xbond-android-<tag>.apk` |
| iOS App Store 歸檔 | `pnpm release:ios <tag>` | `release/<tag>/ios/xbond-ios-<tag>.ipa` |
| OCI 鏡像 | `pnpm release:image <tag>` | `release/<tag>/oci/xbond-oci-<tag>.tar` |

`pnpm package:desktop` 使用目前工作樹及本機平台，編譯並隨包附上同版本 Go daemon，生成供本機驗收的安裝包。此入口免用發佈金鑰，也不需要先跑 `release:core`。預設 Cargo target 根目錄為 `src-tauri/target/`，可用 `CARGO_TARGET_DIR` 覆寫。本機封裝固定使用其下的 `local/`，與發佈建置的原生輸出分開，並在完成時印出安裝包路徑。Linux 上只驗證 Debian 安裝包時可執行 `pnpm package:desktop --bundles deb`。

macOS DMG 由 Finder 寫入背景及圖標佈局。在已登入圖形桌面的 Terminal 執行打包命令。Android debug 封裝會在 AAR 缺失時先建置綁定；修改 Go 移動端後，可先執行 `pnpm android:bind` 更新 AAR。

桌面兩種封裝入口共用同一套 Tauri 呼叫。Tauri 自動讀取 `tauri.<platform>.conf.json` 的格式及外觀設定，`tauri.desktop.conf.json` 提供桌面前端及視窗設定，`tauri.release.conf.json` 提供正式發佈的更新設定。原生工具輸出是建置及本機驗收用目錄，發佈候選以 `release/<tag>/` 為交付位置。

本機與 **Prepare XBond release** 使用同一組 `release:*` 命令。各命令依 Tag 設定版本，呼叫平台工具，並驗證其產物。CI 選擇宿主及工具鏈、注入簽名環境變數、收集產物，然後執行 `pnpm release:assemble <tag>` 整理簽名清單與 Pages。組裝需要該次 Actions run 的證據。本機執行各平台的發佈命令時，使用下方列出的簽名環境變數；OCI 建置需要支援 amd64／arm64 及 OCI archive 匯出的 Docker Buildx builder。單架構宿主可使用帶跨架構模擬的 builder。

本機發佈命令讀取倉庫根的 `.env`。從 [`.env.example`](../.env.example) 複製空白模板後填入所需欄位。PEM 和 P8 使用帶引號的多行文字，Android keystore、Apple P12 和 provisioning profiles 使用單行 Base64。Git 和 Docker 排除實值 `.env`，CI 注入的同名變數優先。

發佈候選以 `release/<tag>/` 為根目錄。下列路徑使用 `v0.4.3` 作例子。

| 目錄 | 產物 |
| --- | --- |
| `web/`、`core/` | `pnpm release:core v0.4.3` 產出網頁、`dashboard.zip`、`SHA256SUMS`，以及 Windows、macOS 和 Linux 各兩個架構的獨立 CLI，例如 `xbond-v0.4.3-windows-amd64.exe`。 |
| `desktop/<os>-<arch>/` | Windows 為 NSIS `.exe`、macOS 為 `.dmg`、Linux 提供 `.deb`、`.rpm` 和 `.AppImage`，例如 `xbond-desktop-v0.4.3-linux-arm64.AppImage`。Windows NSIS 及 Linux AppImage 隨附自動更新用的 `.sig`，macOS 另外產生自動更新用的 `.app.tar.gz` 及其簽名。 |
| `android/` | 以 Android SDK Build-Tools 36.0.0 簽名並校驗應用 ID、版本及簽名指紋的通用 APK `xbond-android-v0.4.3.apk`。 |
| `ios/` | App Store Connect 用的 `xbond-ios-v0.4.3.ipa`，經 TestFlight 或 App Store 安裝。 |
| `oci/` | `xbond-oci-v0.4.3.tar`，含 Linux amd64 和 arm64 鏡像。 |
| `assets/`、`pages/` | GitHub Release 的平鋪資產、簽名清單與 `SHA256SUMS`，以及從同批資產產生的 Pages 網站。 |

同一工作樹建置候選時，先跑 `pnpm release:core v0.4.3`。有目標平台工具鏈及簽名材料時，再在相應宿主跑 `pnpm release:desktop v0.4.3 linux amd64`（按宿主換成 `windows`、`darwin` 或 `linux`，架構用 `amd64` 或 `arm64`）。桌面封裝從同版 `core/` 取出 daemon。Tauri、Gradle 及 Xcode 的原生中間檔由各自工具管理。

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

**Prepare XBond release** 在推 Tag 時自動執行。候選依序經過 preflight（版本、模式與 Apple 簽名旗標單點派生）、check（重用日常 CI 的 Web 與 Go 門禁）、core（CLI 六目標編譯與 dashboard 打包）。Android、iOS 與 OCI 鏡像可與 core 並行，桌面安裝包使用 core 產物中的 daemon，最後 assemble 匯整為一份帶 evidence 的候選並寫入草稿。等 `draft` 成功，從該 run 的摘要進入 Release 草稿，再使用草稿的安裝包及同一 run 的 IPA、OCI 鏡像。提交 SHA、run ID 和兩份摘要可在 `release-evidence.json` 核對。

正式流程按憑據在場情況自動取捨，缺失不阻塞發佈，但如實記錄：`release-desktop-signing` 缺 Developer ID 證書時，macOS 安裝包以 ad-hoc 簽名（無公證，首次打開需右鍵確認）；`release-ios-signing` 缺 iOS 分發證書或描述檔時跳過 IPA 歸檔，`release-evidence.json` 的 `iosSHA256` 為空，草稿摘要會標明。憑據配置後下一個 Tag 自動恢復完整簽名路徑；已配置但失效的憑據會讓工作流失敗，不靜默降級。TestFlight 提交要求非空的 `iosSHA256`。

桌面與移動端共用根目錄的 Tauri 專案。`release:android` 建置 Go AAR 和通用 APK，再用發行金鑰簽署及校驗。`release:ios` 建置 Go XCFramework，透過 Tauri 歸檔主程式及 PacketTunnel，再以兩份 provisioning profiles 匯出 IPA。

## 2. 驗收同版產物

| 平台 | 安裝與驗收 |
| --- | --- |
| CLI、桌面 | Windows（10+）、macOS、Linux 各驗證 amd64 和 arm64 安裝包或獨立二進位。核對 `xbond version --json`，驗證桌面與隨附 daemon 啟動，並在受控環境測試覆蓋安裝、升級及服務失敗恢復。 |
| Android | 安裝簽名 APK，核對版本並驗證 VPN。用同簽名的舊版測試覆蓋安裝和資料保留。 |
| iOS | 從 `main` 執行 **Submit XBond to TestFlight**，填同一 Tag。工作流上傳已校驗的 IPA。在 App Store Connect 把該 build 加入 TestFlight 內部測試群組，實機安裝並驗證隧道、斷線和重連。 |
| Dashboard、Docker | 解壓 `dashboard.zip` 驗證頁面。用候選 OCI 鏡像驗證 Linux amd64 和 arm64，重建容器後確認 `/data` 持續可讀。 |

TestFlight 內部測試需要 Apple Developer 簽名與 App Store Connect 帳號。外部測試可另設邀請連結，首次外部 build 需經 Beta 審核。 [Apple TestFlight](https://developer.apple.com/testflight/)

## 3. 批准公開

從 `main` 執行 **Publish XBond release**，填 `tag`，確認上表後勾選 `install_verified`。由 `release-production` 審核人核對同一候選和驗收記錄後批准。工作流將映像發佈至 `ghcr.io/openxbond/xbond` 的版本標籤，確認可匿名拉取後公開 GitHub Release，並將同一映像摘要發佈為 `latest`。最後部署 Pages，逐項比對線上的頁面與兩份更新清單。

完成後打開下載頁，下載一個產物比對 `SHA256SUMS`。已有公開舊版時，再用 `xbond upgrade --check` 和桌面設定頁確認能找到新版本。 [下載頁](https://openxbond.github.io/xbond/download/)

## 首次設定

在 `openxbond/xbond` 的 GitHub Actions Environments 存放發佈私鑰及平台憑據，在 Repository Variables 配置公鑰、識別碼及 URL。首次設定和輪換後執行 `pnpm release:check`。只演練桌面、CLI 與 Android 時用 `pnpm release:check --rehearsal`。檢查讀取 Secrets 名稱和 Variables，實際金鑰配對、憑據有效性和產物簽名由建置演練驗證。[GitHub Environment Secrets](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#environment-secrets)

| 位置 | 設定 |
| --- | --- |
| Repository Variables | `XBOND_RELEASE_PUBLIC_KEY`（32-byte Ed25519 公鑰的 Base64）、`XBOND_TAURI_PUBLIC_KEY`（Tauri 公鑰檔內容）、`APPLE_TEAM_ID`、`APPLE_SIGNING_IDENTITY`（Developer ID Application 的簽名身分）。有可用條目後才填 `APP_STORE_URL`。有可用的 TestFlight 公開邀請時可填 `IOS_TESTFLIGHT_URL`。 |
| `release-manifest-signing` | Secret `XBOND_RELEASE_PRIVATE_KEY`（配對的 PKCS#8 PEM）。 |
| `release-desktop-signing` | Secrets `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（如有）。macOS 另需 `APPLE_CERTIFICATE`（Developer ID Application P12 的 Base64）、`APPLE_CERTIFICATE_PASSWORD` 及 Apple 團隊 API Key `ASC_KEY`。公證與 TestFlight 共用 Repository Variables `ASC_KEY_ID`、`ASC_ISSUER_ID`。Windows 可配置 `WINDOWS_PFX` 及 `WINDOWS_PFX_PASSWORD`。配置後，CI 在上傳前驗證 Authenticode 簽名及簽署憑證指紋。憑證未配置時，CI 會標示安裝包缺少 Authenticode 簽名。 |
| `release-android-signing` | Secrets `ANDROID_KEYSTORE_BASE64`、`ANDROID_STORE_PASSWORD`。若金鑰密碼與 keystore 密碼不同，設定 `ANDROID_KEY_PASSWORD_OVERRIDE`。Variables `ANDROID_KEY_ALIAS`、`ANDROID_SIGNER_SHA256`（小寫十六進位，無冒號）。後續更新沿用同一簽名身份。 |
| `release-ios-signing` | Apple Developer 組織帳號。為 `net.xbond.app` 和 `net.xbond.app.PacketTunnel` 建立 App Store Connect 發行用 profiles，配置 Network Extension 及 App Group `group.net.xbond.app`。Secrets `IOS_DISTRIBUTION_P12`、`IOS_APP_PROFILE`、`IOS_TUNNEL_PROFILE` 用 Base64，另設 `IOS_DISTRIBUTION_PASSWORD`。 |
| `release-store-ios` | Secret `ASC_KEY`（App Store Connect P8 原文），Variables `ASC_KEY_ID`、`ASC_ISSUER_ID`。 |

維護 GitHub 設定時，確認 Pages 使用 GitHub Actions、啟用不可變 Release、限制 `v*` Tag 的建立及變更，並由審核人批准 `release-production`。放憑據的簽名與商店環境（`release-*-signing`、`release-store-ios`）須配置部署策略，僅允許 `main` 分支與 `v*` Tag。 [GitHub 不可變 Release](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes)

### 建立或輪換簽名材料

1. 用 `pnpm tauri signer generate -w <受控目錄>/tauri-updater.key` 生成帶密碼的桌面更新金鑰。將 `.pub` 檔內容的 Base64 填入 `XBOND_TAURI_PUBLIC_KEY`（Tauri 更新器讀取時會先 Base64 解碼）。將私鑰和密碼填入桌面簽名環境。[Tauri Updater](https://v2.tauri.app/plugin/updater/#signing)
2. 用 `openssl genpkey -algorithm Ed25519 -out <受控目錄>/release-manifest.pem` 生成獨立的清單簽名私鑰，將 PEM 填入 `XBOND_RELEASE_PRIVATE_KEY`。用 `openssl pkey -pubout -outform DER` 匯出對應公鑰，將 DER 末尾 32 bytes 轉為 Base64，填入 `XBOND_RELEASE_PUBLIC_KEY`。CLI 與 Android 都會嵌入這個公鑰。
3. 用 `keytool -genkeypair -storetype PKCS12 -keystore <受控目錄>/xbond-release.keystore -alias xbond-release -keyalg RSA -keysize 2048 -validity 10950` 建立 Android 發行 keystore。將 keystore 的 Base64 和密碼放入 Android 簽名環境，配置 alias 和新憑證的 SHA-256 指紋。使用 25 年以上的憑證有效期，並以 `keytool -list -v` 核對指紋。若之後加入 Google Play，先決定網站 APK 與 Play 安裝能否互相覆蓋更新，再選擇 Play App Signing 的應用簽名金鑰。[Android 簽名指南](https://developer.android.com/studio/publish/app-signing)
4. 把簽名材料及密碼備份到倉庫外的受控私有位置，限制讀取權限。更換時同步更新 GitHub 上配對的公鑰、私鑰、密碼及憑證指紋。已用舊身份安裝的測試版需手動換裝新簽名版。
5. 用 [Tauri macOS 簽名指引](https://v2.tauri.app/distribute/sign/macos/) 配置 Developer ID Application 與公證，用 [Tauri iOS 簽名指引](https://v2.tauri.app/distribute/sign/ios/) 配置 Apple Distribution 與兩份 App Store Connect profiles，再跑帶 Apple 簽名的演練。GitHub 配置檢查通過後，驗收簽名和真機安裝，再按正式發佈流程操作。

## 演練與故障恢復

- **演練**：從 `main` 手動執行 **Prepare XBond release**，填擬定版本並選 `rehearsal`。此模式用臨時 macOS 簽名，跳過 iOS 歸檔。Apple 憑據齊備時選 `rehearsal-with-apple`。已有正式 Tag 時可用 `release` 準備正式候選。演練只產生 Actions artifacts。
- **準備失敗**：重跑原 run 的失敗工作。草稿已收到的檔案會核對後沿用。要改源碼則用更高版本。IPA 和 OCI artifacts 最多保留 90 天，送審或公開前保留原始已校驗檔案。
- **GHCR 或 Pages 失敗**：重跑同一 Tag 的公開工作流。GHCR 首推若套件是私有，先在 Package settings 設為公開。同 Tag 已有不同 digest 時先停止並查明原因。Pages 失敗時先核對目前在線的版本。 [GHCR 套件可見性](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
- **已公開版本需要修正**：用更高版本發佈修正。Docker 可改用原 digest 重建，保留 `/data`。

## 商店上架與更新

沿用公開版的同一個 Tag 和產物。iOS 在 App Store Connect 選擇已驗證的 TestFlight build 提交 App Store 審核。

上架後核對安裝與登入，再填 App Store 的 URL。重跑當前正式 Tag 的 **Publish XBond release** 即可更新下載頁，既有 GitHub Release 和 GHCR 鏡像按摘要沿用。

CLI 用 `xbond upgrade --check` 檢查、`xbond upgrade` 安裝，`--yes` 跳過 CLI 確認，系統級服務仍可能要求原生提權。桌面在設定頁更新，Android 用應用內入口與系統安裝器。iOS 測試版由 TestFlight 更新。商店版由原商店更新。

更新清單（`desktop.json`、`release.json`）客戶端先經 `www.xbond.net/api/clients/update/` 取得：該代理回傳與 Pages 相同內容的簽名清單，並記錄匿名更新檢查（安裝信標契約見 [訂閱導入](specs/subscription-import.md)）。Pages 上的清單是雲端不可用時的回退，仍隨發佈流程同步部署；回退請求不帶信標。
