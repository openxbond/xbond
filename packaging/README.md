# XBond 套件管理器分發清單

本目錄維護各平台第三方套件管理器與更新工具的安裝清單，產物全部對應 [GitHub Releases](https://github.com/openxbond/xbond/releases) 的穩定版產物與 `SHA256SUMS`。以下清單的實際跨平台安裝尚**待目標平台實測**，發佈新穩定版時應先依實際裝置測試再推送外部倉庫。

## 清單一覽與狀態

| 生態 / 平台 | 產物路徑 | 內容說明 | 狀態與消費方式 |
| --- | --- | --- | --- |
| Homebrew（macOS / Linux） | `packaging/homebrew/Casks/xbond.rb`、`packaging/homebrew/Formula/xbond-cli.rb` | macOS 桌面應用 `XBond.app`（arm64 / amd64 DMG）與 CLI 二進位公式 | **待建立獨立 Tap 與實測**：需建 `openxbond/homebrew-tap` 並同步本目錄至該倉庫的 `Casks/` 與 `Formula/` |
| Scoop（Windows） | `packaging/scoop/xbond.json`、`packaging/scoop/xbond-cli.json` | 桌面 NSIS 安裝包與獨立 `xbond.exe`（64bit / arm64），含 `checkver` 與 `autoupdate` | **支援遠端網址安裝（待目標平台實測）**：可執行 `scoop install https://raw.githubusercontent.com/openxbond/xbond/main/packaging/scoop/xbond-cli.json`（桌面把檔名換成 `xbond.json`），亦可另建 `openxbond/scoop-bucket` |
| WinGet（Windows） | `packaging/winget/manifests/o/OpenXBond/XBond/<version>/` | `1.10.0` 多檔格式清單（version / installer / defaultLocale），`Scope: user`、`InstallerType: nullsoft` | **待上游提交與實測**：可用 `winget validate --manifest <dir>` 校驗後，向 `microsoft/winget-pkgs` 提交 PR |
| AUR（Arch Linux） | `packaging/aur/xbond-bin/`、`packaging/aur/xbond-cli-bin/` | `PKGBUILD` 與對應 `.SRCINFO`（x86_64 / aarch64，桌面包解包官方 `.deb` 並聲明 `webkit2gtk-4.1` 等依賴） | **待上游推送與實測**：在 Arch 環境以 `makepkg --printsrcinfo` 與 `namcap` 覆核後推送至 AUR |
| Obtainium（Android） | `packaging/obtainium/xbond.json` | 追蹤 GitHub Releases 的匯入設定（`id: net.xbond.app`，自動按裝置架構篩選 `xbond-android-v*.apk`） | **可直接匯入（待目標平台實測）**：在 Obtainium 匯入設定中匯入 `https://raw.githubusercontent.com/openxbond/xbond/main/packaging/obtainium/xbond.json` 即可追蹤正式版 APK |

## 發版後重新生成

每次穩定版 `vX.Y.Z` 公開並在 GitHub Releases 上傳完整 `SHA256SUMS` 後，在倉庫根目錄執行：

```sh
pnpm release:manifests vX.Y.Z --fetch
```

- 腳本從遠端讀取 `SHA256SUMS` 與發版日期，亦可用 `--checksums <path> --release-date YYYY-MM-DD` 離線生成；候選版（`-rc.N`）明確禁止進入本目錄。
- 每次生成會自動清理 `packaging/winget/manifests/o/OpenXBond/XBond/` 下的舊版目錄，保持清單版本一致。
- 更多發版前檢查與商店流程見 [發佈手冊](../docs/release.md#商店上架與更新)。
