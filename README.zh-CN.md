<p align="center">
  <img src="apps/dashboard/public/favicon.svg" width="96" alt="XBond" />
</p>

<h1 align="center">XBond</h1>

<p align="center">跨平台网络代理客户端 · 桌面 / 移动 / 命令行 / Web / Docker</p>

<div align="center">

[![License](https://img.shields.io/github/license/openxbond/xbond?style=flat-square)](LICENSE) [![CI](https://github.com/openxbond/xbond/actions/workflows/ci.yml/badge.svg)](https://github.com/openxbond/xbond/actions/workflows/ci.yml) [![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20iOS-525B6C?style=flat-square)](https://github.com/openxbond/xbond/releases)

</div>

[繁體中文](README.md) | [English](README.en.md) | 简体中文 | [조선어](README.ko.md) | [فارسی](README.fa.md)

XBond 帮你导入连接配置、建立连接、选择代理策略，并查看网络活动。核心内嵌 [mihomo](https://github.com/MetaCubeX/mihomo) 与 [sing-box](https://github.com/SagerNet/sing-box)，Clash YAML 与 sing-box JSON 两类配置都能直接运行；没有 XBond 账号也可以完整使用第三方订阅。

## 特性

- **全端覆盖**：桌面应用（Windows 10+、macOS、Linux）、移动应用（Android、iOS）与命令行、Web 控制台、Docker 镜像共享同一套能力与领域语义。
- **双核心引擎**：内嵌 mihomo 与 sing-box，按配置类型运行其一，分别原生支持 Clash YAML 与 sing-box JSON。
- **双轨订阅**：第三方订阅（token、URL 或本地配置文件）开箱即用，不要求账号；登录 XBond Cloud 另享账号订阅与服务权益。
- **三种流量接管模式**：系统代理、TUN 与仅端口，按设备权限与场景切换；普通权限的用户会话可把 TUN 委托给机器级服务执行。
- **三层状态如实呈现**：核心可达、流量接管、外部连通分开显示；未连接、加载中与操作失败绝不伪装成已连接。
- **网络活动观测**：实时连接记录、分流规则、DNS 查询与流量统计。
- **订阅历史**：更新保留版本记录，支持回退到先前版本、固定配置，以及为订阅更新选择直连／自代理通道。
- **本机服务**：daemon 可注册为系统服务（用户级或机器级），随系统启动；同一数据目录由实例锁保证单一 daemon，停机走优雅退出。
- **远程管理**：桌面与 Web 界面可添加外部核心控制器、切换控制目标，把远程代理实例纳入同一套界面管理。
- **诊断内建**：`doctor` 自检环境与权限；`bugreport` 导出凭据完全脱敏的诊断包。
- **更新与多语言**：CLI `xbond upgrade` 与桌面应用内建更新入口；界面提供繁體中文、简体中文、English、한국어、فارسی 五种语言。

## 下载

安装包与更新清单统一发布在[下载页](https://openxbond.github.io/xbond/download/)，[GitHub Releases](https://github.com/openxbond/xbond/releases) 提供同一批产物及 SHA256 校验。

| 平台 | 形态 |
| --- | --- |
| Windows 10+ | 桌面应用（NSIS 安装包） |
| macOS | 桌面应用（DMG） |
| Linux | 桌面应用（deb / rpm / AppImage） |
| Android | 按设备架构分发的 APK（arm64-v8a 等）加 universal 包，以 VPN 方式接管流量 |
| iOS | TestFlight |
| 命令行 | Windows / macOS / Linux（amd64 / arm64）独立二进制 |
| Docker | `ghcr.io/openxbond/xbond`（amd64 / arm64） |

## 快速开始

### 桌面

1. 从[下载页](https://openxbond.github.io/xbond/download/)安装对应平台的桌面应用并启动，首次启动会注册并启动本机服务。
2. 登录 XBond 账号，或导入第三方订阅。
3. 选择流量接管模式，开启连接。

### 命令行

```console
$ xbond daemon install             # 注册并启动本机服务（--scope system 装为机器级服务）
$ xbond login                      # 登录 XBond 账号（无界面环境加 --device）
$ xbond sub add <token|url|file>   # 添加第三方订阅
$ xbond up                         # 启动代理核心
$ xbond status                     # 查看三层连接状态、订阅与流量
```

常用命令速查：

| 命令 | 用途 |
| --- | --- |
| `daemon install [--scope user\|system]` · `start` · `stop` · `restart` · `status` · `uninstall` | 安装与管理本机服务 |
| `login [--device]` · `logout` | 登录／登出 XBond 账号；`--device` 走设备码流程，适合无界面环境 |
| `sub add <token\|url\|file>` · `list` · `use` · `update` · `info` · `remove` | 添加与管理第三方订阅 |
| `sub versions` · `rollback` · `unpin` · `channel` · `edit` · `export` | 订阅版本回退、固定与更新通道 |
| `up` · `down` · `mode [sysproxy\|tun\|port]` | 启停连接、查看或切换接管模式 |
| `node list` · `select` · `test` | 策略组与节点管理、延迟测试 |
| `status` · `conns` · `rules` · `dns` · `logs` | 三层状态与网络活动观测 |
| `env` | 输出终端会话的代理变量 |
| `doctor` · `bugreport` | 环境自检与脱敏诊断包 |
| `run --config <file>` | 前台运行独立配置，不经 daemon |
| `upgrade [--check]` · `version` · `web` | 检查更新、版本信息与本机 Web 控制台 |

### Docker

在 XBond Cloud 订阅页复制 Docker 部署指令，即可带着订阅启动端口或 Linux 网关模式。亦可使用本仓库的 Compose 示例：

```console
$ docker compose up -d
```

打开 `http://localhost:19090` 登录 XBond Cloud 或导入订阅；也可在首次启动前设置 `SUB_URL`。配置和登录状态保存在 `/data` 卷，活跃订阅会自动更新，默认 mixed 代理位于 `127.0.0.1:7890`。更新容器版本执行 `docker compose up -d --pull always`。

本地开发可执行 `docker build -t ghcr.io/openxbond/xbond:local .`，再用 `XBOND_IMAGE_TAG=local docker compose up -d --pull never`。详见 [Docker 行为契约](docs/specs/docker-daemon.md)。

## 服务器与无界面环境

XBond 同样适合没有桌面的机器：

- **无界面登录**：`xbond login --device` 走 OAuth 设备码流程，适用于 Docker、SSH 与 headless 主机。
- **远程管理**：Web 控制台既能管理本机，也能作为外部核心控制器的界面——在桌面或 Web 端添加远程实例地址即可切换控制目标。
- **SSH 隧道**：远程 daemon 的管理端口留在回环接口，用 `ssh -L 19090:127.0.0.1:19090 user@host` 即可在本地浏览器打开远程管理界面。能到达界面的用户即可管理 daemon，请勿将管理端口暴露到不可信网络。

如需定时自动更新镜像，在 Docker 宿主机以具备 Docker 权限的账户排程执行，路径换成 Compose 文件所在目录：

```cron
0 4 * * * cd /path/to/xbond && docker compose up -d --pull always
```

## 账号与订阅

XBond 客户端不提供购买流程。账号登录、套餐与服务权益在 XBond Cloud 控制台处理；不登录账号不影响使用第三方订阅或远程控制。

## 遇到问题

1. `xbond status` 核对三层状态：核心可达、流量接管、外部连通逐一检查。
2. `xbond doctor` 自检环境与权限，按提示处理。
3. 回报问题时附上 `xbond bugreport` 导出的诊断包——内容已对凭据完全脱敏，不含订阅地址、token 或 LocalAPI 凭证。

## 开发

本仓库采用 pnpm + Go + Rust 工具链，`pnpm setup` 一键安装依赖，平台工具链与日常命令见以下文档：

- [开发环境](docs/dev-env.md)：工具链及 Web、桌面、移动与 CLI 的日常入口。
- [AGENTS.md](AGENTS.md)：仓库结构、开发命令及共通规则。
- [客户端体系](docs/architecture/client-system.md)：宿主、共享能力与跨仓库契约。
- [开发管线](docs/specs/dev-pipeline.md)：入口路由、实现、UI、审查与维护。
- [验证矩阵](docs/agents/verification.md)：按变更范围选命令及平台验收。
- [发布手册](docs/release.md)：签名、验收与发布流程。

界面文案按语言放在 [`packages/client-ui/src/i18n/messages/`](packages/client-ui/src/i18n/messages/)，CLI 文案在 `internal/i18n/locales/`，欢迎改进现有语言或贡献新语言。

## 授权

XBond 以 [GNU Affero General Public License v3](LICENSE) 发布。内嵌的 mihomo 与 sing-box 采用 GPL-3.0 家族许可证，组合整体依 GPLv3 第 13 条以 AGPL-3.0 传达。第三方开源组件及其许可证见[第三方开源许可](THIRD-PARTY-NOTICES.md)。

---

本文件是 [README.md](README.md)（繁体中文，基准版本）的翻译；内容变更请先更新基准文件。
