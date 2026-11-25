# XBond 套件管理器分發清單

本目錄維護各平台第三方套件管理器與更新工具的安裝清單，產物全部對應 [GitHub Releases](https://github.com/openxbond/xbond/releases) 的穩定版產物與 `SHA256SUMS`。以下清單已按目標平台條件完成實測或本機校驗，尚未驗證的平台仍標示待實測，推送外部倉庫前應維持實機通過標準。

## 清單一覽與狀態

| 生態 / 平台 | 產物路徑 | 內容說明 | 狀態與消費方式 |
| --- | --- | --- | --- |
| Homebrew（macOS / Linux） | `packaging/homebrew/Casks/xbond.rb`、`packaging/homebrew/Formula/xbond-cli.rb` | macOS 桌面應用 `XBond.app`（arm64 / amd64 DMG）與 CLI 二進位公式 | **待建立獨立 Tap 與 macOS 實測**：需建 `openxbond/homebrew-tap` 並同步本目錄至該倉庫的 `Casks/` 與 `Formula/` |
| Scoop（Windows） | `packaging/scoop/xbond.json`、`packaging/scoop/xbond-cli.json` | 桌面 `#/dl.7z` 解包（`xbond-app.exe`＋`xbond-daemon.exe`，避免升級觸發 NSIS 清理用戶資料）與獨立 `xbond.exe`（64bit / arm64），含 `checkver` 與 `autoupdate` | **已通過 Windows 10 AMD64 實機驗證**：兩份清單均已完成 `scoop install` / `version` / 快捷方式 / `scoop uninstall` 實測並通過 Scoop `schema.json` 校驗；可直接執行 `scoop install https://raw.githubusercontent.com/openxbond/xbond/main/packaging/scoop/xbond-cli.json`（桌面把檔名換成 `xbond.json`），亦可另建 `openxbond/scoop-bucket` |
| WinGet（Windows） | `packaging/winget/manifests/o/OpenXBond/XBond/<version>/` | `1.10.0` 多檔格式清單（version / installer / defaultLocale），`Scope: user`、`InstallerType: nullsoft`，含與實機 HKCU Uninstall 一致的 `AppsAndFeaturesEntries`（`Publisher: xbond`） | **已通過官方 1.10.0 Schema 校驗與 Win10 ARP 比對，待 CLI 校驗與上游提交**：待有 Microsoft Store / WinGet 環境執行 `winget validate --manifest <dir>` 後，向 `microsoft/winget-pkgs` 提交 PR |
| AUR（Arch Linux） | `packaging/aur/xbond-bin/`、`packaging/aur/xbond-cli-bin/` | `PKGBUILD` 與對應 `.SRCINFO`（x86_64 / aarch64，桌面包解包官方 `.deb` 並聲明 `webkit2gtk-4.1` 等依賴） | **已通過 Linux 本機 `.deb`/CLI 驗簽、`Depends` 與 `bsdtar` 解包校驗**：待在 Arch 環境補跑 `makepkg --printsrcinfo` 與 `namcap` 後推送至 AUR |
| Obtainium（Android） | `packaging/obtainium/xbond.json` | 追蹤 GitHub Releases 的匯入設定（`{ "apps": [...] }` 格式，`id: net.xbond.app`，自動按裝置架構篩選 `xbond-android-v*.apk`） | **已通過 Android `arm64-v8a`（Obtainium `v1.7.5`）實機驗證**：可直接在 Obtainium 匯入並識別本機 `net.xbond.app` 與線上發行版；匯入 `https://raw.githubusercontent.com/openxbond/xbond/main/packaging/obtainium/xbond.json` 即可追蹤正式版 APK |

## 發版後重新生成

每次穩定版 `vX.Y.Z` 公開並在 GitHub Releases 上傳完整 `SHA256SUMS` 後，在倉庫根目錄執行：

```sh
pnpm release:manifests vX.Y.Z --fetch
```

- 腳本從遠端讀取 `SHA256SUMS` 與發版日期，亦可用 `--checksums <path> --release-date YYYY-MM-DD` 離線生成；候選版（`-rc.N`）明確禁止進入本目錄。
- 每次生成會自動清理 `packaging/winget/manifests/o/OpenXBond/XBond/` 下的舊版目錄，保持清單版本一致。
- 更多發版前檢查與商店流程見 [發佈手冊](../docs/release.md#商店上架與更新)。
