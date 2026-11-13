import fs from "node:fs";
import path from "node:path";

import { optimize } from "@tailwindcss/node";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(
  fs.readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);

/**
 * Tailwind 只在 build 跑 optimize（lightningcss targets: chrome 111、
 * safari 16.4，只降級 Nesting/MediaQueries）把規則內嵌套的 @supports 拍平；
 * serve 直接輸出編譯器原樣產物，嵌套 @supports 要 Chrome 112+ 才能解析，
 * 舊 WebView（如 Waydroid 的 111）在 dev 上只吃到全色回退，alpha 工具類
 * 全不透明、藥丸文字同色不可見。dev 對 Tailwind 產物跑同一個 transform，
 * 兩端產物一致。運行在 tailwind 的 pre transform 之後、normal 階段。
 */
function tailwindDevOptimize(): Plugin {
  return {
    name: "xbond:tailwind-dev-optimize",
    apply: "serve",
    async transform(code, id) {
      const [filePath] = id.split("?");
      if (!filePath.endsWith(".css") || id.includes("/.vite/")) return null;
      // Tailwind 降級指令的標誌串：只有它的輸出帶這個 @supports 查詢。
      if (!code.includes("color-mix(in lab, red, red)")) return null;
      const result = await optimize(code, { minify: false });
      return { code: result.code, map: result.map };
    },
  };
}

export default defineConfig((env) => ({
  root: "apps/dashboard",
  define: {
    __APP_VERSION__: JSON.stringify(process.env.XBOND_VERSION || pkg.version),
  },
  plugins: [
    // jotai 3 dropped its babel plugin packages; dev-only debug labels are
    // not worth a separate jotai-babel setup.
    env.command === "serve" && react(),
    tailwindcss(),
    tailwindDevOptimize(),
    env.mode !== "tauri" &&
      VitePWA({
        injectRegister: false,
        workbox: {
          sourcemap: false,
          navigateFallbackDenylist: [/\/download(?:\/|$)/],
        },
        manifest: {
          icons: [
            {
              src: "./icons/icon-192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "./icons/icon-512.png",
              sizes: "512x512",
              type: "image/png",
            },
          ],
          start_url: "./",
          scope: "./",
          short_name: "XBond",
          name: "XBond Dashboard",
          description: "XBond proxy dashboard",
          // Light --background token; the PWA manifest has no dark variant.
          theme_color: "#eff1f8",
          background_color: "#eff1f8",
          display: "standalone",
        },
      }),
  ],
  server: {
    host:
      process.env.TAURI_ENV_PLATFORM === "android"
        ? "0.0.0.0"
        : (process.env.TAURI_DEV_HOST ?? "127.0.0.1"),
    ws:
      process.env.TAURI_ENV_PLATFORM === "android"
        ? { host: "127.0.0.1", clientPort: 1421 }
        : undefined,
    port: env.mode === "tauri" ? 1420 : 3000,
    strictPort: env.mode === "tauri",
    watch: { ignored: ["**/src-tauri/**"] },
  },
  clearScreen: false,
  base: "./",
  // vite 8 resolves the tsconfig alias map natively; the
  // vite-tsconfig-paths plugin is no longer needed.
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    outDir: path.resolve(env.mode === "tauri" ? "dist/desktop" : "dist/web"),
    emptyOutDir: true,
    target:
      env.mode === "tauri"
        ? ["windows", "win32"].includes(
            process.env.TAURI_ENV_PLATFORM ?? process.platform,
          )
          ? "chrome105"
          : // 與 dev 的 tailwindDevOptimize 同一地板（chrome111／safari16.4）。
            // safari13 會讓 lightningcss 把 inset 邏輯屬性降級成「物理屬性 +
            // :lang() RTL 守衛」，但它生成的 :not(:lang(list))／:where(, …)
            // 首項為空——任何引擎都解析不了，整條規則被丟棄（首頁綢帶的
            // end-0 右錨定因此失效）。safari16.4 起邏輯屬性與 :dir() 原生
            // 支持，無需降級，產物與 dev 一致。
            "safari16.4"
        : undefined,
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      // react-router/jotai/sonner/lucide ship "use client" for RSC frameworks;
      // every module here is client code, so Rolldown dropping the directive
      // is harmless. https://rolldown.rs/in-depth/directives
      checks: { moduleLevelDirective: false },
      output: {
        // keep the vendor bundle split for long-term caching
        manualChunks(id) {
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
}));
