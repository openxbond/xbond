# 桌面應用圖標資產

本目錄下的 PNG、ICO 與 ICNS 檔案均由 `apps/dashboard/public/icons/icon-512.png` 中的官方 XBond 品牌圖標轉換生成，保持統一的品牌視覺資產。

## Windows 安裝器位圖

- `installer-sidebar.bmp`（164×314）：NSIS 歡迎／完成頁側欄，深色畫布配暖橙 aurora。
- `installer-header.bmp`（150×57）：安裝器內頁頁眉，融合 NSIS 對話框底色。

兩者由 `scripts/dev/generate-installer-bitmaps.ts` 從品牌幾何生成（`node scripts/dev/generate-installer-bitmaps.ts`），視覺遵循 DESIGN.md 的「冷瓷與暖橙緞帶」語言，在 `tauri.windows.conf.json` 的 `bundle.windows.nsis` 中引用。
