# 桌面圖標與安裝素材

`icon.png`、`icon.ico` 與 `icon.icns` 從 `apps/dashboard/public/icons/icon-512.png` 的 XBond 應用圖標轉換生成。

執行 `node scripts/dev/generate-installer-bitmaps.ts` 重新生成安裝素材。兩張 `*-ribbon.webp` 是依照 [DESIGN.md](../../DESIGN.md) 冷瓷與暖橙緞帶方向製作的插畫來源。

- `installer-welcome.bmp`（498×628）用於 [Windows 安裝器首屏](../installer-welcome.nsh)，以兩倍像素輸出供高 DPI 縮放。
- `installer-sidebar.bmp`（164×314）用於 NSIS 完成頁，`installer-header.bmp`（150×57）用於內頁頁眉。頁眉底色與 [installer-hooks.nsh](../installer-hooks.nsh) 的 `MUI_BGCOLOR` 一致。
- `installer.ico` 包含 16 至 256 像素的七種尺寸。X 標誌下方的下載圖示用於識別 Windows 安裝程式。
- `dmg-background.png`（660×400）用於 macOS Finder 安裝視窗。調整背景或拖放箭頭時，一併核對 [tauri.macos.conf.json](../tauri.macos.conf.json) 的視窗尺寸及圖標座標。
