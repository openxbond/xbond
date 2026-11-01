// PAC 脚本生成（纯函数）：把 ExtensionConfig v1 的 host 规则编译成 Chromium
// PAC 源码。边界（client-rethink §六 / 平台调研）：
//   - 只做可验证的 host 匹配（精确 / *.后缀），没有进程、端口、IP 段、URL
//     上下文——PAC 里看不到这些；
//   - 不生成 REJECT（Chromium 的 PAC 解析器对 REJECT 不可靠）；
//   - 不做 DIRECT 兜底：入口不可达是显式状态（background 上报），PAC 不得
//     在失败时改道直连；
//   - 凭据绝不进入 PAC（认证走 webRequest onAuthRequired）。

import type { ExtensionConfig, HostRule, ProxyMode } from "./types.ts";

/** 单条规则的命中判定源码：精确命中或（*.前缀时）根域与子域命中。 */
function ruleMatchSource(rule: HostRule): string {
  if (rule.pattern.startsWith("*.")) {
    const root = rule.pattern.slice(2);
    return `h === ${JSON.stringify(root)} || h.endsWith(${JSON.stringify("." + root)})`;
  }
  return `h === ${JSON.stringify(rule.pattern)}`;
}

function normalizeRulePattern(rule: HostRule): HostRule {
  // 大小写归一在 PAC 内做（host 一律小写），pattern 里的根域同样小写化。
  const pattern = rule.pattern.toLowerCase();
  return { pattern, action: rule.action };
}

/**
 * 生成 PAC 源码。mode = "rules" 时按规则分流，defaultAction 兜底；
 * 传 mode = "global" 时返回全入口脚本（保持同一生成路径，便于测试）。
 * 返回值断言不含凭据——调用方直接交给 chrome.proxy，泄露即产品事故。
 */
export function generatePacSource(
  config: ExtensionConfig,
  mode: ProxyMode,
): string {
  const rules = config.rules.map(normalizeRulePattern);
  const host = config.ingress.hosts[0] ?? "";
  const proxyString = `HTTPS ${host}:${config.ingress.port}`;
  // PAC 的返回值是带引号的字符串（"HTTPS host:port" / "DIRECT"）。
  const fallback = JSON.stringify(
    config.defaultAction === "direct" ? "DIRECT" : proxyString,
  );
  if (mode === "global" || rules.length === 0) {
    return `// XBond PAC (global)\nfunction FindProxyForURL(url, host) {\n  return ${JSON.stringify(proxyString)};\n}\n`;
  }
  // 规则以 if 链展开：Chromium 的 PAC 引擎逐条求值，10k 条内开销可测
  // （E-02 探针项）；字符串拼接保持每个判定独立、可读、可静态审计。
  const body = rules
    .map(
      (rule, index) =>
        `  if (${ruleMatchSource(rule)}) return ${JSON.stringify(rule.action === "proxy" ? proxyString : "DIRECT")}; // rule ${index}: ${rule.pattern}`,
    )
    .join("\n");
  return [
    "// XBond PAC (rules)",
    `// rules: ${rules.length}, default: ${config.defaultAction}`,
    "function FindProxyForURL(url, host) {",
    "  var h = (host || '').toLowerCase();",
    body,
    `  return ${fallback};`,
    "}\n",
  ].join("\n");
}

/**
 * 凭据防泄露守卫：生成的 PAC 源码绝不包含认证凭据。background 在每次下发
 * chrome.proxy 前调用，命中即抛错（fail loud）——凭据只允许走 onAuthRequired。
 */
export function assertPacContainsNoCredential(
  source: string,
  credential: string,
): void {
  if (credential && source.includes(credential)) {
    throw new Error("PAC source must never contain the proxy credential");
  }
  if (/\bProxy-Authorization\b|\bbasic\s+[a-z0-9+/=]{8,}\b/i.test(source)) {
    throw new Error("PAC source must never embed proxy auth headers");
  }
}
