import fs from "node:fs";
import path from "node:path";

import react from "@vitejs/plugin-react";
import UnoCSS from "unocss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(
  fs.readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);

export default defineConfig((env) => ({
  root: "web",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    // jotai 3 dropped its babel plugin packages; dev-only debug labels are
    // not worth a separate jotai-babel setup.
    env.command === "serve" && react(),
    UnoCSS({ configFile: path.resolve("uno.config.ts") }),
    env.mode !== "tauri" &&
      VitePWA({
        injectRegister: "inline",
        workbox: {
          sourcemap: false,
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
          theme_color: "#0a0a0a",
          background_color: "#0a0a0a",
          display: "standalone",
        },
      }),
  ],
  server: {
    port: env.mode === "tauri" ? 1420 : 3000,
    strictPort: env.mode === "tauri",
    watch: { ignored: ["**/tauri/**"] },
  },
  clearScreen: false,
  base: "./",
  // vite 8 resolves the tsconfig alias map natively; the
  // vite-tsconfig-paths plugin is no longer needed.
  resolve: {
    tsconfigPaths: true,
  },
  css: {
    preprocessorOptions: {
      scss: {
        // @use must come first in every compiled file; variables.scss
        // only carries SCSS helpers (no CSS output), `as *` keeps the
        // mixin unnamespaced. The modern sass compiler resolves loads
        // against loadPaths only — no CWD fallback.
        additionalData: '@use "sass:math"; @use "styles/variables.scss" as *;',
        loadPaths: [path.resolve("web/src")],
      },
    },
  },
  build: {
    outDir: path.resolve(env.mode === "tauri" ? "dist-desktop" : "dist"),
    emptyOutDir: true,
    target:
      env.mode === "tauri"
        ? ["windows", "win32"].includes(
            process.env.TAURI_ENV_PLATFORM ?? process.platform,
          )
          ? "chrome105"
          : "safari13"
        : undefined,
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        // keep the vendor bundle split for long-term caching
        manualChunks(id) {
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
}));
