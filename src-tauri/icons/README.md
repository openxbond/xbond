# 桌面圖標與安裝素材

`icon.png`、`icon.ico`、`icon.icns` 與 `installer.ico` 全部由 `node scripts/dev/build-logo-assets.ts` 從應用 logo 的同一 SVG 生成。

- `installer.ico` 與 `icon.ico` 同源（圓角深色底 + 橙色 X），僅在右下角疊加橙色下載徽章，用於 Windows 安裝程式（`tauri.windows.conf.json` 的 `installerIcon`）。Windows NSIS 與 macOS DMG 均使用 Tauri 標準嚮導外觀；[installer-hooks.nsh](../installer-hooks.nsh) 僅保留 Windows 10 最低版本檢查。
