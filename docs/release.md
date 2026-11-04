# XBond 發佈與更新

正式版本以 `main` 歷史上的 `vX.Y.Z` Tag 為準。三段數值均為 0–99，整體版本大於 0。CI 把 `X.Y.Z` 注入 CLI、Dashboard、桌面、Android、iOS、擴充功能與容器，Android `versionCode` 和 iOS build number 為 `X × 10000 + Y × 100 + Z`。依賴的代理核心各有自己的版本。

## 一次性設定

- GitHub Pages 的 Source 選 GitHub Actions。開啟 Release immutability，限制 `v*` 的建立與修改。為 `release-production` 設必要審核人、限制從 `main` 發佈並禁止自行批准。簽名及商店環境各自只存該工作需要的密鑰。允許 GitHub Actions 向 `ghcr.io/openxbond/xbond` 寫入，正式套件使用公開可讀的權限。
- 設儲存庫變數 `XBOND_RELEASE_PUBLIC_KEY`，值是 Ed25519 原始 32-byte 公鑰的標準 Base64。在 `release-manifest-signing` 設匹配的 PKCS#8 PEM `XBOND_RELEASE_PRIVATE_KEY`。用 `pnpm tauri signer generate` 另產生 Tauri 金鑰，在 `XBOND_TAURI_PUBLIC_KEY` 放公鑰文件內容，在 `release-desktop-signing` 設 `TAURI_SIGNING_PRIVATE_KEY` 及其密碼。備份兩套私鑰。密鑰輪換需要用仍受信任的舊密鑰發佈帶新公鑰的過渡版本。
- macOS 桌面環境使用 Developer ID Application 憑證及公證帳號。設定 `APPLE_CERTIFICATE`（Base64 P12）、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`。Windows 可在同環境設 `WINDOWS_PFX` 和 `WINDOWS_PFX_PASSWORD`，有配置時安裝包額外用 Authenticode 簽名。
- `release-android-signing` 使用長期 APK 發行密鑰。設定 `ANDROID_KEYSTORE_BASE64`、`ANDROID_STORE_PASSWORD`、`ANDROID_KEY_PASSWORD`、`ANDROID_KEY_ALIAS` 和預期的 `ANDROID_SIGNER_SHA256`。更新包須保留同一簽署身份，應保管密鑰的離線備份。
- `release-ios-signing` 使用組織 Apple Developer 帳號。為 `net.xbond.app` 和 `net.xbond.app.PacketTunnel` 建立含 Network Extension 與 `group.net.xbond.app` App Group 的 App Store provisioning profile。設定 `APPLE_TEAM_ID`、`IOS_DISTRIBUTION_P12`、`IOS_DISTRIBUTION_PASSWORD`、`IOS_APP_PROFILE`、`IOS_TUNNEL_PROFILE`。憑證與 profile 用 Base64。設定 `APP_STORE_URL`、`CHROME_STORE_URL`、`EDGE_STORE_URL` 為正式條目網址。
- `release-store-ios` 設 `ASC_KEY`（P8 內容）、`ASC_KEY_ID`、`ASC_ISSUER_ID`。首次上架 Chrome 與 Edge 用商店後台建立條目，提交同版本 ZIP。後續在 `release-store-chrome` 設 `CHROME_SERVICE_ACCOUNT`（獲商店授權的服務帳號 JSON）、`CHROME_PUBLISHER_ID`、`CHROME_ITEM_ID`，在 `release-store-edge` 設 `EDGE_API_KEY`、`EDGE_CLIENT_ID`、`EDGE_PRODUCT_ID`。

變數可放對應 GitHub Environment，跨多個 job 使用的公鑰、商店連結及 Team ID 放 repository Variables。設定階段用臨時金鑰或受控平台測試，正式環境的操作由維護者執行。

## 發佈流程

1. 確認 `main` 的檢查、版本號和目標提交後推送 Tag。**Prepare XBond release** 產生六種 CLI、六種桌面安裝包、簽署的 Android APK、App Store IPA、MV3 ZIP、`dashboard.zip` 和兩架構 OCI 鏡像，驗證產物後建立 GitHub Release 草稿。也可對已有 Tag 手動執行並開啟 `rehearsal`，使用相同的簽名和驗證流程，只保留 Actions 產物。
2. 從同一草稿與工作流下載或提交商店包。**XBond store operations** 可上傳 iOS IPA 至 App Store Connect。維護者在 TestFlight 確認隧道後送審。首次 Chrome／Edge 上架使用同 Tag 的 MV3 ZIP，後續可執行商店工作流的 `submit` 和 `status`。Edge status 使用提交輸出的 operation ID。提交成功只代表接收，公開前要在三個商店核對實際可安裝版本。提供商店要求的隱私資料、測試帳號及地區資訊。
3. 核對 [RELEASE-01](./tasks/README.md) 的平台演練與三個商店版本後，從 `main` 執行 **Publish XBond release**，兩個 Tag 輸入填同一版本，由生產環境審核人核對。工作流以原始 digest 發佈 GHCR，公開 GitHub Release，再部署 [Dashboard](https://openxbond.github.io/xbond/) 與 [下載頁](https://openxbond.github.io/xbond/download/)。二進位只由 Release 提供，Pages 提供下載連結、更新清單及校驗值。

草稿的部分上傳可重跑原 workflow 的失敗 job，會比較已上傳的內容並只補齊缺項。準備階段的 IPA 與 OCI 產物保留最多 90 天，以儲存庫的 Actions 保留上限為準。已送審的 Tag 應沿用同一批位元組。Pages 部署失敗後，重跑同一 Tag 的公開工作流，已確認 digest 的鏡像與已公開的 Release 會被重用。修正已公開版本時發佈更高版本。

## 用戶操作

- **CLI**：下載對應 Windows、macOS 或 Linux 的 `amd64`／`arm64` 檔案，Unix 需賦予執行權限。`xbond upgrade --check` 只檢查版本，`xbond upgrade` 在確認後更新，`--yes` 用於無人值守。CLI 與桌面依安裝歸屬更新自己的 daemon。正在運行的受管服務會短暫斷線並接受健康檢查，失敗時嘗試恢復上一版。`xbond update` 管理訂閱。
- **桌面**：Windows 使用 NSIS、macOS 使用 DMG、Linux 使用 AppImage。在設定頁檢查及安裝更新。獨立 CLI 管理的 daemon 由其安裝來源更新。
- **手機及擴充功能**：Android 從下載頁或應用內更新，系統會要求批准安裝。iOS、Chrome、Edge 透過對應商店更新。
- **Web 和 Docker**：Dashboard 發現待啟用的新版時會提示重新載入。`dashboard.zip` 可另行解壓並交給 daemon 的 `--web-dir` 使用。Docker 用指定 Tag 或 digest 拉取新鏡像並重建容器，保留 `/data` 卷。
- **完整性**：`SHA256SUMS` 核對 GitHub Release 產物。CLI 和 Android 另驗證 Ed25519 簽名的 `release.json`，並拒絕不匹配的下載。桌面使用 Tauri 簽名的更新產物。

## 本機演練

安裝專案工具鏈後執行 `node scripts/build-release.ts vX.Y.Z`，會用指定版本建 Dashboard 和六種 CLI，輸出到新的 `release/vX.Y.Z/`。沒有注入正式公鑰的二進位僅用於開發演練。完整的簽名安裝包與商店流程以目標平台 CI 和實機結果為準。

發佈附帶原始碼與依賴授權資訊。mihomo、vendored sing-box、wintun.dll 等依賴按各自授權條款分發。
