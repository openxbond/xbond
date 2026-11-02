# 扩展宿主（MV3）规格

XBond 浏览器扩展是独立的交付链路：**只接受 XBond 账号登录**（RFC 8628 设备流，扩展内登录/退出，没有第三方订阅可导入）——登录后以 Bearer 通道拉取 `target=extension` 配置，浏览器网络栈经 chrome.proxy 的 PAC 直连 Agent 的 HTTPS CONNECT 入口，无原生客户端参与。宿主落位 `apps/extension`；Cloud 侧契约见 `docs/specs/proxy-service.md` 的「浏览器扩展配置（target=extension）」与探针记录（cloud 仓库 `docs/tasks/client-extension-probe.md`）。

## 数据路径

```
XBond 账号登录（设备流） → background 以 Bearer 拉取 target=extension（proxyToken、节点密码、策略组、规则集）
浏览器请求 → PAC（规则/全局/直连） → {password 前 12 位}.{Agent 域名}:443
→ TLS（可信域名受信证书，同端口 SNI 复用） → CONNECT + 407 Basic
   username = proxyToken（快照准入）  password = 节点密码（resolveRoute 选出口）
→ Mullvad / Peer SOCKS5 出口 → 目标站点
```

- **凭据口径**：username 准入用户、password 选出口，与 Trojan 客户端同源同口径；PAC 里的节点密码前缀只用于隔离 Chromium 的认证缓存与连接池（不同节点出口可并发），服务端只按 SNI 后缀命中可信域名，不读前缀。
- **认证应答**：`onAuthRequired`（webRequestAuthProvider + asyncBlocking）按 challenger 主机（`{prefix}.{server}`）反查节点回填凭据；同一入口 30 秒内最多应答 3 次，超限显式 `auth-failed`，交回浏览器而不是无限循环。
- **PAC 边界**：只承载可验证条件——`domain`/`domain_suffix`/`domain_keyword` 与 Lan 的 IPv4 `ip_cidr`（isInNet）；IPv6 段无法表达直接剔除；不生成 REJECT（REJECT 以 `PROXY 127.0.0.1:65535` 本地立即失败）；**入口不可达不静默 DIRECT 兜底**——是显式 `unreachable` 状态。控制通道（订阅源域名）在 PAC 里直连放行，入口故障时订阅刷新仍能重试。
- **O(1) 索引**：精确域名与后缀各一张哈希表（后缀逐级查找），关键字线性扫描；规则规模上的每请求开销只有 3~4 次查找。

## 状态机与恢复

`off / ok / no-subscription / auth-failed / unreachable / control-lost / invalid-config / error`。MV3 SW 随时休眠：一切决策从 storage 出发（reconcile），安装/启动/alarms（5 分钟核对 + 每日订阅刷新）/storage 变化都触发重核对；每次核对比较 chrome.proxy 实际设置与 `levelOfControl`——策略或其他扩展夺权是显式 `control-lost`（不自愈、不夺权），本扩展持有设置时偏差自愈（重放 PAC）。刷新失败保留上一份有效配置（宁可旧配置继续可用）。

## 控制权语义

「关闭」或「直连」模式 = 释放本扩展的代理设置（`chrome.proxy.settings.clear`，回到用户/策略自己的配置），不是显式直连。`not_controllable`（企业策略）与 `controlled_by_other_extensions` 原样上报，绝不竞争。

## 威胁模型与凭据分层

access token 存 `storage.session`（会话秘密，浏览器退出即清）；refresh token 存 `storage.local`（重启恢复的前提），proxyToken 与节点密码随配置存 `storage.local`（未加密，扩展生态通行做法）：恶意本机进程与磁盘取证可读。PAC 文本不含 proxyToken 与完整节点密码（生成器带守卫断言）；凭据只出现在 storage 与 onAuthRequired 应答里。登出即清 access/refresh 与用量摘要，配置保留以便重新登录后比对版本。

## 平台事实与未决项（2026-11-02 探针结论）

- Chrome/Edge 的 `onAuthRequired` + `asyncBlocking` 是代理凭据应答的唯一非企业机制。
- **Edge 156 待复测项**（受管机器限制，见 cloud 探针记录）：unpacked 扩展数分钟后被自动禁用（需管理员 `ExtensionInstallAllowlist` 或 Chrome for Testing 验证）；`onAuthRequired` 不唤醒休眠 SW（存活时机制可用）。
- Firefox 走 `proxy.onRequest` 适配器，独立切片。WebRTC/QUIC 泄漏为探针项，本版不做拦截承诺。
