import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";

// 扩展构建：background service worker + popup + 管理页三个入口。manifest 与
// 图标走 publicDir（构建时拷进 dist 根，与 MV3 的路径约定一致）。
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("public", import.meta.url)),
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: fileURLToPath(
          new URL("src/background/index.ts", import.meta.url),
        ),
        "content-import": fileURLToPath(
          new URL("src/content/content-import.ts", import.meta.url),
        ),
        popup: fileURLToPath(new URL("src/popup/index.html", import.meta.url)),
        page: fileURLToPath(new URL("src/page/index.html", import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background" || chunk.name === "content-import"
            ? "[name].js"
            : "assets/[name].js",
      },
    },
  },
});
