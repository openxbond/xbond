import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";

// 扩展构建：background service worker + popup + 管理页三个入口。manifest 与
// 图标走 publicDir（构建时拷进 dist 根，与 MV3 的路径约定一致）。
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("public", import.meta.url)),
  define: {
    // 控制通道 API origin：bypass 列表与（后续切片）账户/配置请求共用。
    __XBOND_API_ORIGIN__: JSON.stringify(
      process.env.XBOND_API_ORIGIN ?? "http://localhost:5000",
    ),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: fileURLToPath(
          new URL("src/background/index.ts", import.meta.url),
        ),
        popup: fileURLToPath(new URL("src/popup/index.html", import.meta.url)),
        page: fileURLToPath(new URL("src/page/index.html", import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name].js",
      },
    },
  },
});
