# 桌面圖標與安裝素材

`icon.png`、`icon.ico` 與 `icon.icns` 從 `apps/dashboard/public/icons/icon-512.png` 的 XBond 應用圖標轉換生成。

執行 `node scripts/dev/generate-installer-bitmaps.ts` 重新生成安裝素材。

- `installer.ico` 包含 16 至 256 像素的七種尺寸，用於 Windows 安裝程式（`tauri.windows.conf.json` 的 `installerIcon`）。Windows NSIS 與 macOS DMG 均使用 Tauri 標準嚮導外觀；[installer-hooks.nsh](../installer-hooks.nsh) 僅保留 Windows 10 最低版本檢查。
