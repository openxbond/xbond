import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// 扩展构建：background service worker + popup + 管理页三个入口。manifest 与
// 图标走 publicDir（构建时拷进 dist 根，与 MV3 的路径约定一致）。
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("public", import.meta.url)),
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss()],
  define: {
    // 控制通道 API origin（账户与 target=extension 拉取）：本地验证可用
    // XBOND_API_ORIGIN 覆盖，控制台域名由发布构建注入。
    __XBOND_API_ORIGIN__: JSON.stringify(
      process.env.XBOND_API_ORIGIN ?? "https://fallback.xbond.dev",
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
