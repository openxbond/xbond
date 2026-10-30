# daemon 生命周期与运行形式

XBond 桌面侧只有一个 Go 可执行文件：`xbond run` 前台运行代理核心，`xbond daemon` 运行可安装的后台控制服务；CLI 与桌面 GUI 共用 LocalAPI。Android、iOS 将同一套 Go 网络能力编译为库，由原生 VPN 生命周期承载。本文件是对外行为承诺；选型理由与被拒替代方案另记录于 ADR（待补）。

## 范围与入口

- `cmd/xbond`：`run`、`daemon` 及 `daemon install|uninstall|start|stop|restart|status`；订阅、节点、日志、诊断等既有命令保留，其余控制命令（`up`／`down`／`restart`／`status`）默认查询 daemon。
- LocalAPI（`/localapi/v0/*`）：CLI（`internal/daemon/client.go`）与前端（`packages/client/src/localapi.ts`）共用。
- 桌面 GUI（Tauri）：与 CLI 对等的 LocalAPI 客户端，不持有第二份状态来源。
- 平台后台托管入口：Windows 任务计划（用户会话）与 SCM（机器级）；Linux systemd --user 与 system unit；macOS LaunchAgent／`SMAppService`（GUI 后台组件）与 Network Extension（GUI VPN）；Android `VpnService`；iOS `NEPacketTunnelProvider`。
- 两个维度相互独立：运行形式（前台、用户级后台、系统级后台、原生 VPN 扩展）与网络权限（本地端口、用户会话系统代理、TUN、路由与 DNS）。安装了服务不代表获得 TUN 权限；Go 代码能编译不代表获得移动端后台运行能力。
- 服务管理选型：机器级系统服务以 `kardianos/service` 为首选候选，作为可替换的平台适配依赖，产品组织不围绕其接口；用户会话注册、macOS 应用注册与移动 VPN 走原生平台适配。

## 行为契约

### run（前台核心）

- 输入：`xbond run --config <file>`（必填）。配置经 `engine.Validate` 验证后立即启动核心，前台运行，日志输出终端。
- 不注册自启动，不启动另一个后台进程，不写 daemon 的发现文件（`localapi.addr`／`localapi.token`）与运行状态。
- 资源冲突必须报错：daemon 已运行核心（同机接管被持有）、或监听端口已被占用时，run 以明确错误退出，不得静默抢占。
- Ctrl+C、终止请求与启动失败进入清理流程；退出时释放本次拥有的监听器与 TUN。
- 普通状态查询属于 daemon；run 实例的身份不与后台实例混淆。

### daemon（前台控制服务）

- 组成：LocalAPI、订阅与偏好管理、核心配置应用与启停、节点／日志／流量／诊断、订阅更新调度。核心停止时 daemon 继续运行，等待下一次 `up`。
- 启动顺序：确认运行身份 → 获取实例锁（早于代理恢复与发现文件写入）→ 初始化状态与恢复资源 → 启动 LocalAPI → 发布发现信息 → 按明确的「自动连接」设置决定是否连接 → 报告就绪。
- 同一数据目录只允许一个 daemon 实例；第二个实例启动失败并指名冲突。
- 停止顺序：进入停止状态 → 拒绝新的配置变更 → 取消调度任务 → 停止核心并释放接管 → 清理自身发现信息 → 关闭接口 → 释放实例锁退出。停止请求被接受不等于清理完成；系统代理恢复失败必须上报，不得打印「已停止」。
- 两个设置独立保存：自动启动后台服务（登录／开机让控制服务就绪）与自动连接（服务就绪后建立连接）。服务启动成功不显示「网络已连接」。

### 服务管理

| 操作 | 目标行为 |
| --- | --- |
| `daemon install` | 注册后台运行方式并启动，确认就绪后报告成功；`--scope user`（默认）或 `--scope system` |
| `daemon uninstall` | 停止并移除注册，保留用户配置 |
| `daemon start` | 启动已注册的服务，确认 LocalAPI 就绪 |
| `daemon stop` | 请求优雅退出（LocalAPI shutdown），等待进程退出，再确认系统管理状态；超时如实报告 |
| `daemon restart` | 完整停止后重新启动并确认就绪 |
| `daemon status` | 分别报告注册状态（未安装／已注册无响应）与运行状态（含核心与接管信息） |

- 普通操作不隐式注册自启动：服务未运行且未安装时，命令报错并给出 `xbond daemon install` 指引，不得静默安装。
- scope：user 注册在当前用户（用户数据目录、用户会话系统代理）；system 注册为机器级服务（经 `kardianos/service` 适配 SCM／system unit／LaunchDaemon，独立数据目录与控制接口授权）。平台或构建不支持某个 scope 时返回明确结果，不得偷换为另一种机制宣称成功。
- 平台注册内容：Windows 用户会话=当前用户登录任务（原生 Task Scheduler API；被策略拒绝时明确报错并提供显式 run-key 备选），Windows 机器级=SCM；Linux user=systemd --user 单元（免登录自启需显式 linger，不得宣称天然开机自启），system=system unit；macOS CLI=LaunchAgent（系统级任务用 LaunchDaemon），正式 GUI=`SMAppService`。注册的都是受监督的前台 `xbond daemon`，程序不再自行 fork；Windows SCM 由服务回调触发同一套启动与关闭流程。
- CLI 与 GUI 控制同一个 daemon：CLI 启动的连接在 GUI 可见；关闭窗口不停止连接；GUI 升级或崩溃不带走网络运行时；配置与状态只有一个来源。四种用户操作语义分离：关闭窗口、退出 GUI、断开连接、停止后台服务。

### 状态模型

| 状态层     | 取值示例                             |
| ---------- | ------------------------------------ |
| 安装与授权 | 未安装、已注册、等待授权、被禁用     |
| 进程与接口 | 已停止、启动中、可用、无响应         |
| 核心       | 空闲、启动中、运行中、停止中、失败   |
| 网络接管   | 未接管、代理已设置、TUN 已建立、失败 |
| 出口验证   | 未检测、检测中、成功、失败           |
| 用户意图   | 希望连接、希望断开                   |

不得由「核心运行中」同时推导接管成功与出口可用。

### 配置与数据

- 用户级 daemon 拥有用户订阅、偏好与凭据；系统级实例有独立数据目录与访问授权；`run` 使用显式配置及隔离的临时运行状态。
- GUI、CLI 通过控制接口修改 daemon 的生效状态，避免并行写文件；原始配置、用户偏好与实际运行配置分别保存；配置应用失败保留上一份可用状态并报告回滚结果。
- 用户级 LocalAPI 使用 loopback HTTP 与受保护的发现文件；系统级特权控制接口使用 Named Pipe、Unix Socket 或 XPC 并验证调用者身份，不因「来自本机」即授权。

## 边界与失败

- 权限不足（任务创建被策略拒绝、无 TUN 权限、无管理员）：明确报错并给出可用路径；不静默降级，不伪造成功。
- 双实例、端口冲突、TUN 已被持有：启动失败，错误指名冲突资源；已知良好状态不被覆盖。
- 停止超时：报告超时与当前状态；恢复代理失败显示具体错误。
- 崩溃恢复由系统管理器与 xbond 共同完成：管理器重启进程，xbond 检查自身遗留资源并恢复状态；是否自动重连由用户意图决定，主动断开不被重试循环重新连接。
- 升级：服务引用稳定安装目录中的可执行文件；CLI、GUI 与后台实例交换版本、实例身份与协议能力；升级=停止到可控状态、替换产物、重启并确认就绪，Windows 处理运行中可执行文件的替换。卸载先清理连接，再移除注册，数据删除是独立行为。
- 移动端隧道出站连接必须接入 `protect()` 等机制，避免重新进入 VPN；同名 Go 方法不足以证明整条调用链已连接。

## 验收条件

- AC-1 实例锁：同一数据目录第二个 daemon 启动失败并指名冲突；释放锁后可再次启动。
- AC-2 run 冲突：daemon 核心运行中执行 `xbond run --config ...`，命令以明确错误退出，无静默抢占；daemon 核心停止时 run 可前台运行。
- AC-3 run 清理：run 运行中收到 Ctrl+C，核心停止、监听释放、进程以 0 退出。
- AC-4 无隐式安装：服务未安装且未运行时执行 `xbond status`，报错含安装指引，不产生任何注册或后台进程。
- AC-5 install：注册并启动后 status 显示运行中；重新登录后服务可用（目标平台验收）。
- AC-6 stop：退出后发现文件已清理、status 如实反映；系统代理恢复失败时输出错误而非「已停止」。
- AC-7 restart：完整停止后重新启动，LocalAPI 可查询。
- AC-8 uninstall：注册移除、daemon 停止，用户配置保留。
- AC-9 scope：`--scope system` 未实现或平台不支持时返回明确「不可用」，不偷换为 user。
- AC-10 GUI 关窗后，CLI 查询到的连接仍在（与 AC-5 联动，桌面平台验收）。
- AC-11 移动端：Android `VpnService` 与 iOS `PacketTunnelProvider` 完成原生桥接并跑通真实流量（后续任务）。

## 已知限制

- 已实现：单二进制的 `daemon` 子命令与用户级注册（systemd --user／LaunchAgent／HKCU Run）、LocalAPI 优雅 shutdown、Windows Run key 安装全周期实测；Linux／macOS 仅有编译与单元测试证据。
- 已承诺未实作：`run` 命令；实例锁；stop 的退出等待确认；`--scope system`（kardianos 后端）；Windows 用户会话的原生 Task Scheduler API 注册（现为 HKCU Run，无进程监督，升级路径为 COM 注册并显式处理策略拒绝）；macOS `SMAppService`；GUI／CLI／Tauri 启动契约统一（Tauri 仍直接 detached 拉起 `xbond daemon`）；移动端原生桥接（Android `TunnelService` 占位、iOS 扩展未接 Go 核心、mobile 三层状态直接映射 running 需修正）。
- 刻意不支持：run 与 daemon 静默共享同机接管资源；scope 之间偷换冒充成功。

## 落地顺序

S1 单 CLI 收敛 `run`／`daemon`，提取共享运行逻辑；S2 实例锁、就绪检查与可靠停止；S3 CLI 与 Tauri 启动契约统一、删除隐式安装；S4 三桌面安装后端与权限边界验证；S5 移动端桥接与真实流量验收。切片与证据记录见 [任务](../tasks/daemon-runtime.md)。
