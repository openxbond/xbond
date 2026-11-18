# XBond 發佈手冊

發佈分兩條線：**候選（RC）反覆驗收** 與 **穩定版公開**。一次候選用一個 `vX.Y.Z-rc.N`；驗收通過後再用同基線的 `vX.Y.Z` 公開。候選不會進入穩定更新清單、不會推 `latest` 容器標籤。iOS 首發透過 TestFlight 安裝，App Store 可之後上架。

分支與版本規則見[分支、提交與版本政策](specs/branch-and-release-policy.md)：功能與修復經 PR squash 直接進入 `main`；`chore(release): X.Y.Z` 發布提交即里程碑邊界；Tag 只從 `main` 首父提交建立。每個版本的用戶更新說明按語言放在 `docs/releases/<version>/<locale>.md`，發佈流程直接讀取整個目錄。

## 版本與 Tag

- **穩定版**：`vX.Y.Z`，三段各 0–99、無前置零，整體大於零。作為公開與穩定自動更新的唯一來源。
- **候選版（RC）**：`vX.Y.Z-rc.N`（`N` 為 1–98）。用於可安裝驗收與試錯，不佔用穩定版號；同一 `X.Y.Z` 基線可連續遞增 `rc.1`、`rc.2`…，最終再發 `vX.Y.Z`。
- **順序與構建號**：同基線內 `vX.Y.Z-rc.1 < vX.Y.Z-rc.2 < vX.Y.Z`，且均高於上一個已公開的穩定版；構建號為 `(major*10000+minor*100+patch)*100+slot`（穩定版 slot 99，候選 slot 為 `N`），由 `release-version.ts` 單點計算，Go 更新器、Android 應用內更新與 iOS 歸檔都按同一公式校驗。穩定版必須高於上一個已公開穩定版；`rc.N` 不得低於或等於已存在的公開候選構建。
- **iOS 候選**：Apple 不接受帶 `-rc` 的 marketing version，RC 的 IPA 使用同基線數字版本（如 `1.0.0`）加遞增構建號；IPA 檔名仍用 Tag（`xbond-ios-v1.0.0-rc.1.ipa`），TestFlight 以構建號區分。
- **桌面候選**：Linux 的 deb/rpm 版本同樣不接受 `-`，桌面 RC 安裝包一律以數字基底版本打包（與 iOS 一致）。因此同基線穩定版發布後，桌面 RC 不會收到自動更新提示，需手動安裝穩定版；Android 依構建號、iOS 依 TestFlight 可正常升級。
- **不可變**：一個 Tag／版本號對應一條帶證據的候選鏈（commit、run、摘要/簽名）。公開後絕不復用；已產出的候選視為佔用，有問題修復後升 `rc.N` 或升穩定補丁號。
- **Tag 來源**：只從 `main` 的首父提交建立，該提交必須是已驗收的里程碑合併或 release blocker 修復；分支與合流規則見[分支與版本政策](specs/branch-and-release-policy.md)。
- **更新說明**：每個版本一個 `docs/releases/<x.y.z>/` 目錄，按 locale 分檔；`zh-hk.md`、`en-us.md`、`zh-cn.md`、`ko.md`、`fa.md` 五個檔案都必要。RC 與穩定版共用同一份基線說明；真實 Tag 缺少任何一個語言時 preflight 失敗，演練才回退到 conventional 提交彙總。
- **版本來源**：檔案版本只在 `package.json` 維護；`pnpm version:set <x.y.z>` 一次同步其餘來源（Tauri、Cargo、iOS 工程、Android 版本回退、Go 預設與前端回退），`pnpm check:version`（已包含在 `pnpm check`）校驗一致。候選號只存在於 Tag，不寫進檔案版本。

## 建置入口與產物

在倉庫根目錄執行 `package.json` 的命令。Tauri 負責編譯原生殼及封裝，XBond 腳本負責準備 Go daemon 或 gomobile 綁定，以及發佈版本、簽名和產物整理。

| 用途 | 命令 | 產物 |
| --- | --- | --- |
| 編譯 Web | `pnpm build` | `dist/web/` |
| 編譯本機 CLI | `pnpm cli:build` | `dist/cli/xbond`，Windows 為 `xbond.exe` |
| 編譯桌面程式 | `pnpm build:desktop` | `dist/desktop/` 前端資源及 Cargo release 執行檔 |
| 本機桌面安裝包 | `pnpm package:desktop` | Tauri 的 `<Cargo target>/local/<Rust triple>/release/bundle/` |
| Android debug APK | `pnpm package:android [target]` | `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`；帶 target 時包內僅對應 ABI 的庫，輸出路徑不變 |
| 本機候選預覽 | `pnpm release:preview <tag>` | `release/<tag>/preview/`：web、`dashboard.zip` 與宿主 CLI；先跑版本規則校驗（幾分鐘內暴露版本/裝配錯誤） |
| Web 與 CLI 發佈候選 | `pnpm release:core <tag>` | `release/<tag>/web/` 及 `release/<tag>/core/` |
| 桌面發佈候選 | `pnpm release:desktop <tag> <os> <arch>` | `release/<tag>/desktop/<os>-<arch>/` |
| Android 發佈候選 | `pnpm release:android <tag>` | `release/<tag>/android/`：四個 per-ABI APK 加 universal |
| iOS App Store 歸檔 | `pnpm release:ios <tag>` | `release/<tag>/ios/xbond-ios-<tag>.ipa` |
| OCI 鏡像 | `pnpm release:image <tag>` | `release/<tag>/oci/xbond-oci-<tag>.tar` |

`<tag>` 可為穩定 `vX.Y.Z` 或候選 `vX.Y.Z-rc.N`。

`pnpm package:desktop` 使用目前工作樹及本機平台，編譯並隨包附上同版本 Go daemon，生成供本機驗收的安裝包。此入口免用發佈金鑰，也不需要先跑 `release:core`。預設 Cargo target 根目錄為 `src-tauri/target/`，可用 `CARGO_TARGET_DIR` 覆寫。本機封裝固定使用其下的 `local/`，與發佈建置的原生輸出分開，並在完成時印出安裝包路徑。Linux 上只驗證 Debian 安裝包時可執行 `pnpm package:desktop --bundles deb`。

macOS DMG 由 Finder 寫入背景及圖標佈局。在已登入圖形桌面的 Terminal 執行打包命令。Android debug 封裝會在 AAR 缺失時先建置綁定；修改 Go 移動端後，可先執行 `pnpm android:bind` 更新 AAR。本地 `.env`（由腳本以 `--env-file-if-exists=.env` 讀取）配置 release 簽名時，debug APK 可用同一憑證簽署，便於覆蓋安裝與真機調試。

桌面兩種封裝入口共用同一套 Tauri 呼叫。Tauri 自動讀取 `tauri.<platform>.conf.json` 的格式及外觀設定，`tauri.desktop.conf.json` 提供桌面前端及視窗設定，`tauri.release.conf.json` 提供正式發佈的更新設定。原生工具輸出是建置及本機驗收用目錄，發佈候選以 `release/<tag>/` 為交付位置。

本機與 **Prepare XBond release** 使用同一組 `release:*` 命令。各命令依 Tag 設定版本，呼叫平台工具，並驗證其產物。CI 選擇宿主及工具鏈、注入簽名環境變數、收集產物，然後執行 `pnpm release:assemble <tag>` 整理簽名清單與 Pages。組裝需要該次 Actions run 的證據。本機執行各平台的發佈命令時，使用下方列出的簽名環境變數；OCI 建置需要支援 amd64／arm64 及 OCI archive 匯出的 Docker Buildx builder。

本機發佈命令讀取倉庫根的 `.env`。從 [`.env.example`](../.env.example) 複製空白模板後填入所需欄位。PEM 和 P8 使用帶引號的多行文字，Android keystore、Apple P12 和 provisioning profiles 使用單行 Base64。Git 和 Docker 排除實值 `.env`，CI 注入的同名變數優先。

發佈候選以 `release/<tag>/` 為根目錄。下列路徑使用 `v1.0.0-rc.1` 作例子。

| 目錄 | 產物 |
| --- | --- |
| `web/`、`core/` | `pnpm release:core v1.0.0-rc.1` 產出網頁、`dashboard.zip`、`SHA256SUMS`，以及 Windows、macOS 和 Linux 各兩個架構的獨立 CLI，例如 `xbond-v1.0.0-rc.1-windows-amd64.exe`。 |
| `desktop/<os>-<arch>/` | Windows 為 NSIS `.exe`、macOS 為 `.dmg`、Linux 提供 `.deb`、`.rpm` 和 `.AppImage`，例如 `xbond-desktop-v1.0.0-rc.1-linux-arm64.AppImage`。Windows NSIS 及 Linux AppImage 隨附自動更新用的 `.sig`，macOS 另外產生自動更新用的 `.app.tar.gz` 及其簽名。 |
| `android/` | 以 Android SDK Build-Tools 36.0.0 簽名並校驗應用 ID、版本及簽名指紋的 APK：四個 per-ABI 包 `xbond-android-v1.0.0-rc.1-<abi>.apk`（`arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64`），加 universal `xbond-android-v1.0.0-rc.1.apk`。應用內更新按設備 ABI 取 per-ABI 包，不用 universal。 |
| `ios/` | App Store Connect 用的 `xbond-ios-v1.0.0-rc.1.ipa`，經 TestFlight 或 App Store 安裝。 |
| `oci/` | `xbond-oci-v1.0.0-rc.1.tar`，含 Linux amd64 和 arm64 鏡像。 |
| `assets/`、`pages/` | GitHub Release 的平鋪資產、簽名清單與 `SHA256SUMS`，以及由同批資產產生的站點與更新清單。 |

同一工作樹建置候選時，先跑 `pnpm release:core <tag>`。有目標平台工具鏈及簽名材料時，再在相應宿主跑 `pnpm release:desktop <tag> <os> <arch>`（`os` 為 `windows`/`darwin`/`linux`，`arch` 為 `amd64`/`arm64`）。桌面封裝從同版 `core/` 取出 daemon。

## 建議工作流（最佳實踐）

1. **整合與自測（不佔號）**：`main` 保持可建置且 CI 通過；功能與修復從 `main` 開短命分支，經 PR squash 合入。用本地包自測（`pnpm package:android`、`pnpm package:desktop` 等）；動到版本或打包腳本時先跑 `pnpm release:preview <tag>`；驗證鏈路與簽名用手動 **Prepare XBond release** 的 `rehearsal` / `rehearsal-with-apple`（僅產出 Actions artifacts，不推正式 Tag）。
2. **定版準備（不佔號）**：從 `main` 開 `chore/release-X.Y.Z`，完成 `pnpm version:set X.Y.Z`、`docs/releases/X.Y.Z/<locale>.md` 各語言更新說明及 `pnpm check`，PR 以標題 `chore(release): X.Y.Z` squash 合入 `main`；`main` 首父提交即本次里程碑邊界。
3. **切候選（佔 `rc.N`）**：在該發布提交（或候選迭代修復後的 `main` 末端提交）打 `vX.Y.Z-rc.1` 並推送。**Prepare XBond release** 自動執行 preflight → check → core/desktop/android/ios/image → assemble，產出帶 evidence 的草稿（標記為 GitHub pre-release）。從草稿 assets（同一 run）下載安裝驗收。只驗部分平台時用手動觸發的 `platforms`（如 `android`、`android,image`）：只產 artifacts、不生成草稿；完整候選用預設 `all`。
4. **迭代**：驗收發現問題則修復經 PR squash 帶回 `main`，之後直接在 `main` 末端升 `rc.N` 重切候選；更新說明同步補在同一份 `docs/releases/X.Y.Z/`，不覆用舊 Tag。
5. **定版公開**：目標候選通過後，打 `vX.Y.Z`（同基線）推送並 Prepare，完成驗收後執行 **Publish XBond release**。穩定版會進入下載頁、穩定更新清單與 `latest` 映像。

RC 產物可用於安裝與 TestFlight 驗收，但**不得**作為穩定自動更新來源；公開穩定版前的試錯消耗 `rc.N`，不消耗新的穩定版號。

發布說明優先讀取 `docs/releases/<version>/` 下的各語言檔案，按 `zh-hk`、`en-us`、`zh-cn`、`ko`、`fa` 順序分段；真實 Tag 缺少任何一個語言時 preflight 失敗。演練或檔案缺失時才由 `scripts/release/notes.ts` 按 Conventional Commits 彙總，隱藏 `chore`、`ci`、`docs`、`test`、`style`、`build`，附升級須知與完整比較連結，正文不含 hash。更新說明面向用戶，寫新增能力、行為改進、修復與升級須知，不列提交清單。

## 1. 推 Tag 與 Prepare

選擇遠端 `main` 上已驗收的發布提交或其後的候選迭代／release blocker 修復提交；版本、`docs/releases/<version>/` 與 Tag 必須一致。

```powershell
$ReleaseTag = 'v1.0.0-rc.1' # 或穩定版 'v1.0.0'
git fetch origin --tags
if ($LASTEXITCODE -ne 0) { throw '讀取遠端失敗' }
git tag -a $ReleaseTag origin/main -m "XBond $ReleaseTag"
if ($LASTEXITCODE -ne 0) { throw '建立 Tag 失敗' }
git push origin "refs/tags/$ReleaseTag"
```

**Prepare XBond release** 在推 Tag 時自動執行。候選依序經過 preflight（版本、模式與 Apple 簽名旗標單點派生）、check（重用日常 CI 的 Web 與 Go 門禁）、core（CLI 六目標編譯與 dashboard 打包）。Android、iOS 與 OCI 鏡像可與 core 並行，桌面安裝包使用 core 產物中的 daemon，最後 assemble 匯整為一份帶 evidence 的候選並寫入草稿。等 `draft` 成功，從該 run 的摘要進入 Release 草稿，再使用草稿的安裝包及同一 run 的 IPA、OCI 鏡像。提交 SHA、run ID 和兩份摘要可在 `release-evidence.json` 核對。

- **穩定 Tag（`vX.Y.Z`）**：草稿供公開流程使用；發佈後更新穩定清單與 `latest`。
- **RC Tag（`vX.Y.Z-rc.N`）**：草稿標記為 pre-release，供驗收；**不執行 Publish**，不更新穩定清單與 `latest`。
- **rehearsal**：手動從 `main` 執行、選 `rehearsal`（或 `rehearsal-with-apple`），僅產出 Actions artifacts。

正式流程按憑據在場情況自動取捨，缺失不阻塞發佈，但如實記錄：`release-desktop-signing` 缺 Developer ID 證書時，macOS 安裝包以 ad-hoc 簽名（無公證，首次打開需右鍵確認）；`release-ios-signing` 缺 iOS 分發證書或描述檔時跳過 IPA 歸檔，`release-evidence.json` 的 `iosSHA256` 為空，草稿摘要會標明。憑據配置後下一個 Tag 自動恢復完整簽名路徑；已配置但失效的憑據會讓工作流失敗，不靜默降級。TestFlight 提交要求非空的 `iosSHA256`。

## 2. 驗收同版產物

| 平台 | 安裝與驗收 |
| --- | --- |
| CLI、桌面 | Windows（10+）、macOS、Linux 各驗證 amd64 和 arm64 安裝包或獨立二進位。核對 `xbond version --json`，驗證桌面與隨附 daemon 啟動，並在受控環境測試覆蓋安裝、升級及服務失敗恢復。 |
| Android | 安裝簽名 APK，核對版本並驗證 VPN。用同簽名的舊版測試覆蓋安裝和資料保留；RC 與穩定版構建號單調遞增，可覆蓋安裝。 |
| iOS | 從 `main` 執行 **Submit XBond to TestFlight**，填同一 Tag（穩定或 RC）。工作流上傳已校驗的 IPA。在 App Store Connect 把該 build 加入 TestFlight 內部測試群組，實機安裝並驗證隧道、斷線和重連。 |
| Dashboard、Docker | 解壓 `dashboard.zip` 驗證頁面。用候選 OCI 鏡像驗證 Linux amd64 和 arm64，重建容器後確認 `/data` 持續可讀。 |

只驗收草稿/同一 run 的最終 assets，並用 `SHA256SUMS` 與 `apksigner verify --print-certs` 等核對；勿使用檔名含 `unsigned` 或來自中間目錄、下載不完整的包。

TestFlight 內部測試需要 Apple Developer 簽名與 App Store Connect 帳號。外部測試可另設邀請連結，首次外部 build 需經 Beta 審核。 [Apple TestFlight](https://developer.apple.com/testflight/)

## 3. 批准公開（僅穩定 Tag）

從 `main` 執行 **Publish XBond release**，填 **穩定** `vX.Y.Z` tag，確認上表後勾選 `install_verified`——勾選即表示驗收記錄已由觸發者核對，工作流直接執行。工作流將映像發佈至 `ghcr.io/openxbond/xbond` 的版本標籤，確認可匿名拉取後公開 GitHub Release，並將同一映像摘要發佈為 `latest`。最後部署 Pages，逐項比對線上的頁面與兩份更新清單。觸發與發佈操作以 `xbond-automation[bot]` 身份執行，公開記錄不出現個人帳號。

RC Tag 不可走此流程（工作流會拒絕）；RC 發佈後保持 pre-release 供下載驗收即可。

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

維護 GitHub 設定時，確認 Pages 使用 GitHub Actions、關閉不可變 Release、限制 `v*` Tag 的建立及變更；`release-production` 只保留部署分支策略（`main`），不以個人帳號做環境審核人。不可變 Release 開啟時，GitHub 會永久保留曾用於 release 的 tag 名——`v1.0.0` 即因此在刪除 release 後無法重建（GH013 報 creations restricted，管理面不可見、無 bypass），只能棄用該版本號；防重複使用由 `protect-release-tags` ruleset 與「公開後絕不復用」政策承擔，不需要這個功能。ghcr.io 的 `xbond` container package 若已存在（非本工作流首推自動建包），須在其 Package settings 的 Manage Actions access 把 `openxbond/xbond` 加入並選 Write，否則發佈工作流推鏡像被拒 `write_package`。放憑據的簽名與商店環境（`release-*-signing`、`release-store-ios`）須配置部署策略，允許 `main` 分支與 `v*` Tag。策略必須標明類型：分支規則 `type: branch`、Tag 規則 `type: tag`——未標明類型的規則一律視為分支規則，tag 部署會被環境保護拒絕。環境清單與策略的期望狀態以 `pnpm release:check` 為準，漂移即報錯。

### 建立或輪換簽名材料

1. 用 `pnpm tauri signer generate -w <受控目錄>/tauri-updater.key` 生成帶密碼的桌面更新金鑰。將 `.pub` 檔內容的 Base64 填入 `XBOND_TAURI_PUBLIC_KEY`（Tauri 更新器讀取時會先 Base64 解碼）。將私鑰和密碼填入桌面簽名環境。[Tauri Updater](https://v2.tauri.app/plugin/updater/#signing)
2. 用 `openssl genpkey -algorithm Ed25519 -out <受控目錄>/release-manifest.pem` 生成獨立的清單簽名私鑰，將 PEM 填入 `XBOND_RELEASE_PRIVATE_KEY`。用 `openssl pkey -pubout -outform DER` 匯出對應公鑰，將 DER 末尾 32 bytes 轉為 Base64，填入 `XBOND_RELEASE_PUBLIC_KEY`。CLI 與 Android 都會嵌入這個公鑰。
3. 用 `keytool -genkeypair -storetype PKCS12 -keystore <受控目錄>/xbond-release.keystore -alias xbond-release -keyalg RSA -keysize 2048 -validity 10950` 建立 Android 發行 keystore。將 keystore 的 Base64 和密碼放入 Android 簽名環境，配置 alias 和新憑證的 SHA-256 指紋。
4. 把簽名材料及密碼備份到倉庫外的受控私有位置，限制讀取權限。更換時同步更新 GitHub 上配對的公鑰、私鑰、密碼及憑證指紋。已用舊身份安裝的測試版需手動換裝新簽名版。

## 演練、RC 與故障恢復

- **演練（不佔號）**：從 `main` 手動執行 **Prepare XBond release**，填擬定版本並選 `rehearsal`。此模式用臨時 macOS 簽名，跳過 iOS 歸檔。Apple 憑據齊備時選 `rehearsal-with-apple`。演練只產生 Actions artifacts。
- **RC（佔 `rc.N`）**：推 `vX.Y.Z-rc.N` tag 產生可驗收的 pre-release 草稿與同版構建產物；迭代用 `rc.2`、`rc.3`。RC 不發佈穩定清單、不推 `latest`。
- **穩定版**：推 `vX.Y.Z` tag，驗收後執行 **Publish XBond release**（`install_verified=true`）公開並更新清單/`latest`/Pages。
- **準備失敗**：重跑原 run 的失敗工作。草稿已收到的檔案會核對後沿用。要改源碼則用更高版本（升 `rc.N` 或升穩定補丁號）。**未產出草稿的失敗 run 可直接重跑同一個 Tag**（重跑不會產生第二份草稿，evidence 仍記錄 run id）；一旦草稿已生成或版本已公開，就只能升號。IPA 和 OCI artifacts 最多保留 90 天，送審或公開前保留原始已校驗檔案。
- **GHCR 或 Pages 失敗**：穩定版發佈失敗可重跑同一 Tag 的公開工作流。GHCR 首推若套件是私有，先在 Package settings 設為公開；若推鏡像報 `write_package` 被拒，在 Package settings 的 Manage Actions access 把 `openxbond/xbond` 加入並選 Write，再重跑原 run。同 Tag 已有不同 digest 時先停止並查明原因。 [GHCR 套件可見性](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
- **已公開版本需要修正**：用更高穩定版本發佈修正。Docker 可改用原 digest 重建，保留 `/data`。

## 預發布（Beta）通道

RC 預設只做草稿，不進穩定更新通道。需要讓測試者自動跟上候選時，再開啟此通道：

- **發布候選**：Prepare 產生草稿後，從 `main` 執行 **Publish XBond candidate**，填該 `vX.Y.Z-rc.N`。工作流會重新校驗 `release-evidence.json`（commit、run、摘要）再把草稿轉為**公開 pre-release**；不改 Pages、不改穩定清單與 `latest`。
- **CLI 訂閱**：`xbond upgrade --channel beta`（預設 `stable`）。beta 通道以 GitHub API 取**最新公開 pre-release** 的 `release.json`，用同一發佈公鑰驗簽，再按構建號比較；未開啟時完全不受影響。
- **Android**：目前仍需手動下載 pre-release 的 APK 安裝；設定開關與真機驗證列為後續（通道清單已可被同一簽名驗證）。
- **桌面**：Tauri 更新器端點是靜態設定，維持只走穩定通道；RC 使用者需手動安裝同基線穩定版。
- **不可覆蓋**：已公開的候選不能重傳或替換；修正一律發新的 `rc.N`。immutable releases 開啟期間發佈的 rc 在服務端仍不可變，該功能現已關閉（見[首次設定](#首次設定)），不再為新 release 產生永久佔名。

## 商店上架與更新

沿用公開版或候選的同一個 Tag 和產物。iOS 在 App Store Connect 選擇已驗證的 TestFlight build（可來自穩定或 RC Tag）提交 App Store 審核。

上架後核對安裝與登入，再填 App Store 的 URL。重跑當前正式穩定 Tag 的 **Publish XBond release** 即可更新下載頁，既有 GitHub Release 和 GHCR 鏡像按摘要沿用。

CLI 用 `xbond upgrade --check` 檢查、`xbond upgrade` 安裝，`--yes` 跳過 CLI 確認，系統級服務仍可能要求原生提權。桌面在設定頁更新，Android 用應用內入口與系統安裝器。iOS 測試版由 TestFlight 更新。商店版由原商店更新。

更新清單（`desktop.json`、`release.json`）客戶端先經 `www.xbond.net/api/clients/update/` 取得：該代理回傳與 Pages 相同內容的簽名清單，並記錄匿名更新檢查（安裝信標契約見 [訂閱導入](specs/subscription-import.md)）。Pages 上的清單是雲端不可用時的回退，仍隨發佈流程同步部署；回退請求不帶信標。**僅穩定版發佈會更新這些清單與 `latest` 映像**；RC 不進入穩定更新通道。
