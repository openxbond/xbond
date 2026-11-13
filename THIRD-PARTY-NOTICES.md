# 第三方開源許可

XBond 使用並分發以下第三方開源組件。本清單按技術棳分組，列出版本、許可證及上游位置；間接（傳遞）依賴不在逐一列舉範圍，完整鎖定清單見 `go.sum`、`pnpm-lock.yaml` 及 `src-tauri/Cargo.lock`，各組件保留其上游許可與版權聲明。

XBond 本身以 [GNU AGPL-3.0](LICENSE) 發佈。代理核心 mihomo 與 sing-box 採用 GPL-3.0 家族許可證，XBond 與它們以 Go 庫引用方式連結為一體，按 GPLv3 第 13 條的組合許可，組合整體即以 AGPL-3.0 傳達，亦因此對應的網絡互動義務同樣成立。

## 代理核心（Go）

| 組件 | 版本 | 許可證 | 上游 |
| --- | --- | --- | --- |
| mihomo | v1.19.33 | GPL-3.0，另附條款¹ | <https://github.com/MetaCubeX/mihomo> |
| sing-box | v1.13.21 | GPL-3.0-or-later，另附條款² | <https://github.com/SagerNet/sing-box> |
| sing | v0.8.14 | GPL-3.0-or-later | <https://github.com/sagernet/sing> |
| sing-tun | v0.8.15 | GPL-3.0-or-later | <https://github.com/sagernet/sing-tun> |

¹ mihomo 附加條款：與 MetaCubeX 無關聯的下游項目不得在名稱中使用 "mihomo" 字樣。² sing-box 附加條款：未經事先同意，衍生作品不得使用其名稱或暗示與該應用存在關聯。

## Go 直接依賴（CLI、daemon 與移動綁定）

| 組件 | 版本 | 許可證 | 上游 |
| --- | --- | --- | --- |
| cobra | v1.10.2 | Apache-2.0 | <https://github.com/spf13/cobra> |
| go-i18n/v2 | v2.6.1 | MIT | <https://github.com/nicksnyder/go-i18n> |
| go-winio（tailscale fork） | v0.0.0-20231025203758 | MIT | <https://github.com/tailscale/go-winio> |
| golang.org/x/net | v0.61.0 | BSD-3-Clause | <https://github.com/golang/net> |
| golang.org/x/oauth2 | v0.37.0 | BSD-3-Clause | <https://github.com/golang/oauth2> |
| golang.org/x/sys | v0.49.0 | BSD-3-Clause | <https://github.com/golang/sys> |
| golang.org/x/text | v0.43.0 | BSD-3-Clause | <https://github.com/golang/text> |
| gopkg.in/yaml.v3 | v3.0.1 | MIT OR Apache-2.0 | <https://github.com/go-yaml/yaml> |
| gomobile（綁定生成工具） | golang.org/x/mobile | BSD-3-Clause | <https://github.com/golang/mobile> |

## Tauri 殼與桌面能力（Rust）

| 組件 | 版本 | 許可證 | 上游 |
| --- | --- | --- | --- |
| tauri | 2.12.4 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/tauri> |
| tauri-build | 2.7.3 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/tauri> |
| tauri-plugin-deep-link | 2.6.3 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/plugins-workspace> |
| tauri-plugin-opener | 2.7.2 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/plugins-workspace> |
| tauri-plugin-single-instance | 2.5.4 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/plugins-workspace> |
| tauri-plugin-window-state | 2.5.0 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/plugins-workspace> |
| tauri-plugin-autostart | 2.7.0 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/plugins-workspace> |
| tauri-plugin-clipboard-manager | 2.5.0 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/plugins-workspace> |
| tauri-plugin-notification | 2.8.0 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/plugins-workspace> |
| tauri-plugin-dialog | 2.8.4 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/plugins-workspace> |
| tauri-plugin-global-shortcut | 2.4.1 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/plugins-workspace> |
| tauri-plugin-updater | 2.14.1 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/plugins-workspace> |
| serde | 1.0.229 | MIT OR Apache-2.0 | <https://github.com/serde-rs/serde> |
| serde_json | 1.0.154 | MIT OR Apache-2.0 | <https://github.com/serde-rs/json> |
| ureq | 2.12.1 | MIT OR Apache-2.0 | <https://github.com/algesten/ureq> |
| thiserror | 2.0.21 | MIT OR Apache-2.0 | <https://github.com/dtolnay/thiserror> |
| windows-sys | 0.61.2 | MIT OR Apache-2.0 | <https://github.com/microsoft/windows-rs> |
| windows-version | 0.1.7 | MIT OR Apache-2.0 | <https://github.com/microsoft/windows-rs> |

## 共用前端（React）

| 組件 | 版本 | 許可證 | 上游 |
| --- | --- | --- | --- |
| react / react-dom | 19.3.0 | MIT | <https://github.com/facebook/react> |
| react-router-dom | 7.18.4 | MIT | <https://github.com/remix-run/react-router> |
| jotai | 3.0.1 | MIT | <https://github.com/pmndrs/jotai> |
| immer / use-immer | 11.1.21 / 0.11.0 | MIT | <https://github.com/immerjs/immer> |
| swr | 2.5.1 | MIT | <https://github.com/vercel/swr> |
| axios | 1.20.0 | MIT | <https://github.com/axios/axios> |
| eventemitter3 | 5.0.4 | MIT | <https://github.com/primus/eventemitter3> |
| @react-hookz/web | 26.1.0 | MIT | <https://github.com/react-hookz/web> |
| @tanstack/react-table | 8.21.3 | MIT | <https://github.com/TanStack/table> |
| react-window | 2.3.3 | MIT | <https://github.com/bvaughn/react-window> |
| remeda | 2.51.0 | MIT | <https://github.com/remeda/remeda> |
| radix-ui | 1.8.1 | MIT | <https://github.com/radix-ui/primitives> |
| class-variance-authority | 0.7.1 | Apache-2.0 | <https://github.com/joe-bell/cva> |
| clsx | 2.1.1 | MIT | <https://github.com/lukeed/clsx> |
| tailwind-merge | 3.7.0 | MIT | <https://github.com/dcastil/tailwind-merge> |
| tailwindcss | 4.3.3 | MIT | <https://github.com/tailwindlabs/tailwindcss> |
| tw-animate-css | 1.4.0 | MIT | <https://github.com/Wombosvideo/tw-animate-css> |
| lucide-react | 1.66.0 | ISC | <https://github.com/lucide-icons/lucide> |
| dayjs | 1.11.23 | MIT | <https://github.com/iamkun/dayjs> |
| i18next / react-i18next | 26.5.11 / 17.1.9 | MIT | <https://github.com/i18next/i18next> |
| type-fest | 5.10.0 | MIT OR CC0-1.0 | <https://github.com/sindresorhus/type-fest> |
| flag-icons | 7.6.0 | MIT | <https://github.com/lipis/flag-icons> |
| sonner | 2.0.8 | MIT | <https://github.com/emilkowalski/sonner> |
| @tauri-apps/api | 2.12.4 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/tauri> |

## 開發與建置工具（npm devDependencies）

| 組件 | 版本 | 許可證 | 上游 |
| --- | --- | --- | --- |
| vite | 8.3.4 | MIT | <https://github.com/vitejs/vite> |
| @vitejs/plugin-react | 6.1.2 | MIT | <https://github.com/vitejs/vite-plugin-react> |
| vite-plugin-pwa | 2.0.0 | MIT | <https://github.com/vite-pwa/vite-plugin-pwa> |
| typescript | 7.0.2 | Apache-2.0 | <https://github.com/microsoft/TypeScript> |
| @tauri-apps/cli | 2.12.3 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/tauri> |
| @types/node / @types/react / @types/react-dom | 24.19.1 / 19.3.0 | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| tailwindcss 工具鏈（@tailwindcss/node、@tailwindcss/vite） | 4.3.3 | MIT | <https://github.com/tailwindlabs/tailwindcss> |
| oxlint / oxc-parser | 1.87.0 / 0.150.0 | MIT | <https://github.com/oxc-project/oxc> |
| oxfmt | 0.71.0 | MIT | <https://github.com/oxc-project/oxfmt> |
| lefthook | 2.2.2 | MIT | <https://github.com/evilmartians/lefthook> |
| sharp | 0.35.5 | Apache-2.0 | <https://github.com/lovell/sharp> |
| @resvg/resvg-js | 2.6.2 | MPL-2.0 | <https://github.com/thx/resvg-js> |

## Android 原生（Kotlin）

| 組件 | 版本 | 許可證 | 上游 |
| --- | --- | --- | --- |
| androidx.core:core-ktx | 1.13.1 | Apache-2.0 | <https://developer.android.com/jetpack/androidx/releases/core> |
| androidx.appcompat:appcompat | 1.7.1 | Apache-2.0 | <https://developer.android.com/jetpack/androidx/releases/appcompat> |
| androidx.activity:activity-ktx | 1.10.1 | Apache-2.0 | <https://developer.android.com/jetpack/androidx/releases/activity> |
| androidx.lifecycle:lifecycle-process | 2.10.0 | Apache-2.0 | <https://developer.android.com/jetpack/androidx/releases/lifecycle> |
| androidx.webkit:webkit | 1.14.0 | Apache-2.0 | <https://developer.android.com/jetpack/androidx/releases/webkit> |
| com.google.android.material:material | 1.12.0 | Apache-2.0 | <https://github.com/material-components/material-components-android> |

iOS 端僅使用 Apple 系統框架（NetworkExtension、UIKit 等），無第三方二進位依賴。

## 其他

| 資源 | 說明 |
| --- | --- |
| clash-iconfont 圖標字型 | 界面圖標字型由 `at.alicdn.com` CDN 遠端載入，源自 Clash 生態共享 iconfont 項目，未隨 XBond 分發。 |
| 系統字型 | 界面使用平台系統字型（Segoe UI、Roboto、Noto Sans CJK 等），隨各平台授權提供。 |

## GPL 核心源碼取得

XBond 內嵌的 mihomo 與 sing-box 均以未修改的 Go 模組依賴方式引入，版本以 `go.mod` 鎖定。對應完整源碼及各許可證全文見上表上游位置。
