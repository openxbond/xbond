<p align="center">
  <img src="apps/dashboard/public/favicon.svg" width="96" alt="XBond" />
</p>

<h1 align="center">XBond</h1>

<p align="center">跨平台網絡代理用戶端 · 桌面 / 移動 / 命令列 / Web / Docker</p>

<div align="center">

[![License](https://img.shields.io/github/license/openxbond/xbond?style=flat-square)](LICENSE) [![CI](https://github.com/openxbond/xbond/actions/workflows/ci.yml/badge.svg)](https://github.com/openxbond/xbond/actions/workflows/ci.yml) [![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20iOS-525B6C?style=flat-square)](https://github.com/openxbond/xbond/releases)

</div>

XBond 幫你匯入連線配置、建立連線、選擇代理策略，並查看網絡活動。核心內嵌 [mihomo](https://github.com/MetaCubeX/mihomo) 與 [sing-box](https://github.com/SagerNet/sing-box)，Clash YAML 與 sing-box JSON 兩類配置都能直接運行；沒有 XBond 帳號也可以完整使用第三方訂閱。

## 特性

- **全端覆蓋**：桌面應用（Windows 10+、macOS、Linux）、移動應用（Android、iOS）與命令列、Web 控制台、Docker 映像共享同一套能力與領域語義。
- **雙核心引擎**：內嵌 mihomo 與 sing-box，依配置類型運行其一，分別原生支持 Clash YAML 與 sing-box JSON。
- **雙軌訂閱**：第三方訂閱（token、URL 或本地配置檔）開箱即用，不要求帳號；登入 XBond Cloud 另享帳號訂閱與服務權益。
- **三種流量接管模式**：系統代理、TUN 與僅端口，按裝置權限與場景切換；普通權限的用戶會話可把 TUN 委託給機器級服務執行。
- **三層狀態如實呈現**：核心可達、流量接管、外部連通分開顯示；未連線、載入中與操作失敗絕不偽裝成已連線。
- **網絡活動觀測**：即時連線記錄、分流規則、DNS 查詢與流量統計。
- **訂閱歷史**：更新保留版本記錄，支持回退到先前版本、固定配置，以及為訂閱更新選擇直連／自代理通道。
- **本機服務**：daemon 可註冊為系統服務（用戶級或機器級），隨系統啟動；同一資料目錄由實例鎖保證單一 daemon，停機走優雅退出。
- **遠程管理**：桌面與 Web 界面可添加外部核心控制器、切換控制目標，把遠端代理實例納入同一套界面管理。
- **診斷內建**：`doctor` 自檢環境與權限；`bugreport` 導出憑據完全脫敏的診斷包。
- **更新與多語言**：CLI `xbond upgrade` 與桌面應用內建更新入口；界面提供繁體中文、簡體中文、English、한국어、فارسی 五種語言。

## 下載

安裝包與更新清單統一發佈在[下載頁](https://openxbond.github.io/xbond/download/)，[GitHub Releases](https://github.com/openxbond/xbond/releases) 提供同一批產物及 SHA256 校驗。專案仍在積極開發中，正式發佈前各平台交付以下載頁為準。

| 平台        | 形態                                               |
| ----------- | -------------------------------------------------- |
| Windows 10+ | 桌面應用（NSIS 安裝包）                            |
| macOS       | 桌面應用（DMG）                                    |
| Linux       | 桌面應用（deb / rpm / AppImage）                   |
| Android     | 通用 APK，以 VPN 方式接管流量                      |
| iOS         | TestFlight                                         |
| 命令列      | Windows / macOS / Linux（amd64 / arm64）獨立二進位 |
| Docker      | `ghcr.io/openxbond/xbond`（amd64 / arm64）         |

## 快速開始

### 桌面

1. 從[下載頁](https://openxbond.github.io/xbond/download/)安裝對應平台的桌面應用並啟動，首次啟動會註冊並啟動本機服務。
2. 登入 XBond 帳號，或匯入第三方訂閱。
3. 選擇流量接管模式，開啟連線。

### 命令列

```console
$ xbond daemon install             # 註冊並啟動本機服務（--scope system 裝為機器級服務）
$ xbond login                      # 登入 XBond 帳號（無界面環境加 --device）
$ xbond sub add <token|url|file>   # 加入第三方訂閱
$ xbond up                         # 啟動代理核心
$ xbond status                     # 查看三層連線狀態、訂閱與流量
```

常用命令速查：

| 命令 | 用途 |
| --- | --- |
| `daemon install [--scope user\|system]` · `start` · `stop` · `restart` · `status` · `uninstall` | 安裝與管理本機服務 |
| `login [--device]` · `logout` | 登入／登出 XBond 帳號；`--device` 走設備碼流程，適合無界面環境 |
| `sub add <token\|url\|file>` · `list` · `use` · `update` · `info` · `remove` | 添加與管理第三方訂閱 |
| `sub versions` · `rollback` · `unpin` · `channel` · `edit` · `export` | 訂閱版本回退、固定與更新通道 |
| `up` · `down` · `mode [sysproxy\|tun\|port]` | 啟停連線、查看或切換接管模式 |
| `node list` · `select` · `test` | 策略組與節點管理、延遲測試 |
| `status` · `conns` · `rules` · `dns` · `logs` | 三層狀態與網絡活動觀測 |
| `env` | 輸出終端會話的代理變數 |
| `doctor` · `bugreport` | 環境自檢與脫敏診斷包 |
| `run --config <file>` | 前台運行獨立配置，不經 daemon |
| `upgrade [--check]` · `version` · `web` | 檢查更新、版本信息與本機 Web 控制台 |

### Docker

在 XBond Cloud 訂閱頁複製 Docker 部署指令，即可帶着訂閱啟動端口或 Linux 網關模式。亦可使用本倉庫的 Compose 範例：

```console
$ docker compose up -d
```

打開 `http://localhost:19090` 登入 XBond Cloud 或匯入訂閱；也可在首次啟動前設定 `SUB_URL`。配置和登入狀態保存在 `/data` 卷，活躍訂閱會自動更新，預設 mixed 代理位於 `127.0.0.1:7890`。更新容器版本執行 `docker compose up -d --pull always`。

本機開發可執行 `docker build -t ghcr.io/openxbond/xbond:local .`，再用 `XBOND_IMAGE_TAG=local docker compose up -d --pull never`。詳見 [Docker 行為契約](docs/specs/docker-daemon.md)。

## 服務器與無界面環境

XBond 同樣適合沒有桌面的機器：

- **無界面登入**：`xbond login --device` 走 OAuth 設備碼流程，適用於 Docker、SSH 與 headless 主機。
- **遠程管理**：Web 控制台既能管理本機，也能作為外部核心控制器的界面——在桌面或 Web 端添加遠端實例地址即可切換控制目標。
- **SSH 隧道**：遠端 daemon 的管理端口留在回環介面，用 `ssh -L 19090:127.0.0.1:19090 user@host` 即可在本機瀏覽器打開遠端管理界面。能到達界面的用戶即可管理 daemon，請勿將管理端口暴露到不可信網絡。

如需定時自動更新映像，在 Docker 宿主機以具備 Docker 權限的帳戶排程執行，路徑換成 Compose 檔案所在目錄：

```cron
0 4 * * * cd /path/to/xbond && docker compose up -d --pull always
```

## 帳號與訂閱

XBond 客戶端不提供購買流程。帳號登入、套餐與服務權益在 XBond Cloud 控制台處理；不登入帳號不影響使用第三方訂閱或遠程控制。

## 遇到問題

1. `xbond status` 核對三層狀態：核心可達、流量接管、外部連通逐一檢查。
2. `xbond doctor` 自檢環境與權限，按提示處理。
3. 回報問題時附上 `xbond bugreport` 導出的診斷包——內容已對憑據完全脫敏，不含訂閱地址、token 或 LocalAPI 憑證。

## 開發

本倉庫採用 pnpm + Go + Rust 工具鏈，`pnpm setup` 一鍵安裝依賴，平台工具鏈與日常命令見以下文檔：

- [開發環境](docs/dev-env.md)：工具鏈及 Web、桌面、移動與 CLI 的日常入口。
- [AGENTS.md](AGENTS.md)：倉庫結構、開發命令及共通規則。
- [用戶端體系](docs/architecture/client-system.md)：宿主、共享能力與跨倉庫契約。
- [開發管線](docs/specs/dev-pipeline.md)：入口路由、實作、UI、審查與維護。
- [驗證矩陣](docs/agents/verification.md)：按變更範圍選命令及平台驗收。
- [發佈手冊](docs/release.md)：簽名、驗收與發佈流程。

界面文案按語言放在 [`packages/client-ui/src/i18n/messages/`](packages/client-ui/src/i18n/messages/)，CLI 文案在 `internal/i18n/locales/`，歡迎改進現有語言或貢獻新語言。

## 授權

XBond 以 [GNU Affero General Public License v3](LICENSE) 發佈。內嵌的 mihomo 與 sing-box 採用 GPL-3.0 家族許可證，組合整體依 GPLv3 第 13 條以 AGPL-3.0 傳達。第三方開源組件及其許可證見[第三方開源許可](THIRD-PARTY-NOTICES.md)。
