# XBond

XBond 是一款跨平台網絡代理用戶端：匯入連線配置、建立連線、選擇代理策略，查看網絡活動並處理連線問題。同一套能力以多種形態交付——桌面應用、移動應用、命令列、Web 控制台與 Docker 映像。

## 功能特點

- **雙核心引擎**：內嵌 mihomo 與 sing-box 兩個代理核心，依配置類型運行其一，分別支持 Clash YAML 與 sing-box JSON。
- **雙軌訂閱**：登入 XBond 帳號啟用訂閱，或加入通用第三方訂閱（token、URL 或本地配置檔）；沒有 XBond 帳號同樣能使用第三方配置。
- **三種流量接管模式**：系統代理、TUN 與僅端口，按裝置權限與場景切換。
- **策略組與節點**：查看策略組與節點、測試延遲、為策略組選定出口。
- **網絡活動**：即時連線記錄、分流規則與流量統計。
- **三層狀態**：核心可達、流量接管、外部連通分別呈現；未連線、載入中與操作失敗都如實顯示，不偽裝成已連線。
- **本機服務**：daemon 可註冊為背景服務隨系統啟動；Web 控制台管理本機，也可作為遠端實例的控制器介面。
- **診斷工具**：`doctor` 自檢環境與權限；`bugreport` 匯出憑據完全脫敏的診斷包，方便回報問題。
- **自動更新**：`xbond upgrade --check` 檢查新版本，桌面應用內建更新入口。

## 下載

各平台安裝包與更新清單統一發佈在[下載頁](https://openxbond.github.io/xbond/download/)，GitHub Releases 提供同一批產物及 SHA256 校驗。

| 平台 | 形態 |
| --- | --- |
| Windows（10+）· macOS · Linux | 桌面應用（amd64 / arm64），內含本機服務與 Web 管理介面 |
| Android | APK 安裝包，以 VPN 方式接管流量 |
| iOS | TestFlight |
| 命令列 | `xbond` 獨立二進位 |
| Docker | `ghcr.io/openxbond/xbond` |

專案仍在積極開發中，各平台實際可用的交付以下載頁為準。

## 快速開始

### 桌面

1. 從下載頁安裝對應平台的桌面應用並啟動；首次啟動會註冊並啟動本機服務。
2. 在介面中登入 XBond 帳號，或匯入第三方訂閱。
3. 選擇流量接管模式，開啟連線。

### 命令列

```console
$ xbond daemon install             # 註冊並啟動本機服務（背景自動啟動）
$ xbond sub add <token|url|file>   # 加入訂閱
$ xbond up                         # 啟動代理核心
$ xbond mode tun                   # 查看或切換接管與路由模式
$ xbond status                     # 查看三層連線狀態、訂閱與流量
$ xbond web                        # 打開本機 Web 管理介面
```

常用操作：`xbond node list|select|test` 管理策略組與節點、`xbond sub update` 更新訂閱、`xbond conns` 查看活動連線、`xbond env` 輸出終端會話的代理變數。

### Docker

在 XBond Cloud 訂閱頁複製 Docker 部署指令，即可帶着訂閱啟動端口或 Linux 網關模式。亦可使用本倉庫的 Compose 範例：

```console
$ docker compose up -d
```

打開 `http://localhost:9090` 登入 XBond Cloud 或匯入訂閱。也可在首次啟動前設定 `SUB_URL`。配置和登入狀態保存在 `/data` 卷，活躍訂閱會自動更新。預設 mixed 代理位於 `127.0.0.1:7890`。

遠端 Docker 主機可用 `ssh -L 9090:127.0.0.1:9090 user@host`，再打開本機的管理介面。能到達介面的用戶即可管理 daemon，請將管理端口留在回環介面。

更新容器版本可執行 `docker compose up -d --pull always`。如需自動更新映像，可在 Docker 宿主機用具備 Docker 權限的帳戶排程執行，將下方路徑換成 Compose 檔案所在目錄：

```cron
0 4 * * * cd /path/to/xbond && docker compose up -d --pull always
```

本機開發可執行 `docker build -t ghcr.io/openxbond/xbond:local .`，再用 `XBOND_IMAGE_TAG=local docker compose up -d --pull never`。詳見 [Docker 行為契約](docs/specs/docker-daemon.md)。

## 帳號與購買

XBond 客戶端不提供購買流程。帳號登入、套餐與服務權益在 XBond Cloud 控制台處理；不登入帳號不影響使用第三方訂閱或遠端控制。

## 遇到問題

先執行 `xbond status` 核對三層狀態，再跑 `xbond doctor` 自檢；回報問題時附上 `xbond bugreport` 產生的診斷包，內容已對憑據完全脫敏，不含訂閱地址、token 或 LocalAPI 憑證。

## 開發者

- [開發環境](docs/dev-env.md)：工具鏈及 Web、桌面、移動與 CLI 的日常入口。

- [AGENTS.md](AGENTS.md)：倉庫結構、開發命令及共通規則。
- [開發管線](docs/specs/dev-pipeline.md)：入口路由、實作、UI、審查與維護。
- [驗證矩陣](docs/agents/verification.md)：按變更範圍選命令及平台驗收。
- [發佈手冊](docs/release.md)：簽名、驗收與發佈流程。

## 授權

[MIT](LICENSE)
