# 扩展宿主（MV3）规格

XBond 浏览器扩展是独立的交付链路：浏览器网络栈 → Agent HTTPS 代理入口 → 指定出口，无原生客户端参与。宿主落位 `apps/extension`，Cloud 侧契约见 `docs/specs/proxy-service.md` 的「浏览器扩展配置签发」与探针记录（cloud 仓库 `docs/tasks/client-extension-probe.md`）。

## 架构与归属

- **MV3 background 是控制面**：账户（RFC 8628 设备流）、配置拉取（extension-config v1）、代理设置（chrome.proxy）、认证应答（webRequest onAuthRequired）。用户流量永远不经过扩展进程——那是浏览器网络栈与 Agent 之间的事。
- **凭据分层**：access token 存 `storage.session`（会话秘密，浏览器退出即清）；refresh token 存 `storage.local`（持久化以支撑重启恢复）。代理凭据（Proxy Token）随配置存 `storage.local`。扩展没有安全的秘密存储（chrome.storage 不加密）；威胁模型 = 恶意本机进程与磁盘取证风险，与浏览器扩展生态的通行做法一致。Device flow 集成零登记（unpacked 扩展 ID 逐机不同，`launchWebAuthFlow` 重定向需商店固定 ID 后再评估）。
- **代理凭据的边界**：凭据只经 onAuthRequired 应答，绝不进 PAC（生成器带守卫断言）、不打日志、不进 URL。
- **PAC 能力边界**：规则仅限可验证的 host 匹配（精确 / `*.后缀`）；无进程、端口、IP 段、URL 上下文；不生成 REJECT（Chromium PAC 解析器不可靠）；入口不可达**不静默 DIRECT 兜底**——是显式状态（unreachable）。

## 状态机与恢复

状态：`off / ok / no-config / signed-out / pending-login / auth-failed / unreachable / control-lost / invalid-config / error`。MV3 SW 随时休眠：一切决策从 storage 出发（reconcile），`onInstalled`／`onStartup`／alarms（5 分钟核对 + 每日配置刷新）／storage 变化都触发重核对；每次核对比较 chrome.proxy 实际设置与 `levelOfControl`，策略或其他扩展夺权是显式 `control-lost`（不自愈、不夺回）；本扩展持有设置时偏差自愈（重放期望值）。认证应答有上界：同一入口 30 秒内最多应答 3 次质询，超限显式 `auth-failed`，把失败交给浏览器而不是无限循环。

## 控制权语义

「关闭」= 释放本扩展的代理设置（`chrome.proxy.settings.clear`，回到用户/策略自己的配置），不是显式直连。`not_controllable`（企业策略）与 `controlled_by_other_extensions` 原样上报，绝不竞争。

## 平台事实与未决项（2026-11-02 探针结论）

- Chrome/Edge 的 `onAuthRequired` + `asyncBlocking` 是代理凭据应答的唯一非企业机制；扩展需 `webRequest`+`webRequestAuthProvider` 权限与目标 URL 的 host_permissions。
- **Edge 156 待复测项**（受管机器限制，见探针记录）：unpacked 扩展数分钟后被自动禁用（需管理员 `ExtensionInstallAllowlist` 或 Chrome for Testing 验证）；`onAuthRequired` 不唤醒休眠 SW（存活时机制可用）。若 Chrome 复现同样问题，产品对策是代理启用期间的保活或凭据预取（`storage.session` 常驻层），在真机证据落地前不预做。
- Firefox 走 `proxy.onRequest` 适配器，独立切片。WebRTC/QUIC 泄漏为探针项，本版不做拦截承诺。
