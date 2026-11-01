// 配置校验（纯函数）：把不可信输入（Cloud 签发响应 / 手动表单）归一为
// ExtensionConfig v1，或给出明确拒绝理由。原则与数据面一致——fail loud：
// 不认识的字段结构、不可验证的规则形状一律拒绝，绝不静默降级。

import type { ExtensionConfig, HostRule } from "./types.ts";

export class InvalidConfigError extends Error {}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new InvalidConfigError(`${field} must be a non-empty string`);
  }
  return value;
}

function requirePort(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65535
  ) {
    throw new InvalidConfigError(
      `${field} must be an integer port in [1, 65535]`,
    );
  }
  return value;
}

/** 入口 host 校验：主机名或 IP 字面量，不带 scheme、路径与端口。 */
function requireHost(value: unknown, field: string): string {
  const host = requireString(value, field);
  if (host.includes("/") || host.includes(":") || host.includes("?")) {
    throw new InvalidConfigError(
      `${field} must be a bare hostname, got ${JSON.stringify(host)}`,
    );
  }
  if (!/^[a-z0-9.\-[\]]+$/i.test(host)) {
    throw new InvalidConfigError(
      `${field} has unsupported characters: ${JSON.stringify(host)}`,
    );
  }
  return host;
}

/**
 * 规则形状校验：只接受可被 PAC 忠实表达的 host 匹配——精确域名或 *.后缀
 * （后缀含根域）。其他一切（通配混排、IP 段、端口、正则、REJECT）都拒绝：
 * PAC 没有可靠的进程/端口/IP 上下文，静默接受只会造成规则语义漂移。
 */
export function parseHostRule(value: unknown, index: number): HostRule {
  if (typeof value !== "object" || value === null) {
    throw new InvalidConfigError(`rules[${index}] must be an object`);
  }
  const record = value as Record<string, unknown>;
  const action = record.action;
  if (action !== "proxy" && action !== "direct") {
    throw new InvalidConfigError(
      `rules[${index}].action must be "proxy" or "direct"`,
    );
  }
  const pattern = requireString(record.pattern, `rules[${index}].pattern`);
  let root = pattern;
  if (root.startsWith("*.")) {
    root = root.slice(2);
  } else if (root.includes("*") || root.includes("?")) {
    throw new InvalidConfigError(
      `rules[${index}].pattern only supports exact hosts or a leading "*."; got ${JSON.stringify(pattern)}`,
    );
  }
  requireHost(root, `rules[${index}].pattern`);
  return { pattern, action };
}

/**
 * 归一任意外部输入为 ExtensionConfig v1。configVersion 以外的一律拒绝。
 * credential 恒为字符串（可为空串——无凭据入口），绝不让对象或数字穿透。
 */
export function parseExtensionConfig(input: unknown): ExtensionConfig {
  if (typeof input !== "object" || input === null) {
    throw new InvalidConfigError("config must be an object");
  }
  const record = input as Record<string, unknown>;
  if (record.configVersion !== 1) {
    throw new InvalidConfigError(
      `unsupported configVersion: ${String(record.configVersion)}`,
    );
  }
  const issuanceVersion = requireString(
    record.issuanceVersion,
    "issuanceVersion",
  );
  if (typeof record.ingress !== "object" || record.ingress === null) {
    throw new InvalidConfigError("ingress must be an object");
  }
  const ingress = record.ingress as Record<string, unknown>;
  const hosts = ingress.hosts;
  if (!Array.isArray(hosts) || hosts.length === 0) {
    throw new InvalidConfigError("ingress.hosts must be a non-empty array");
  }
  if (ingress.tls === false) {
    throw new InvalidConfigError(
      "ingress.tls must be true: browsers only accept TLS proxies",
    );
  }
  const auth = record.auth;
  if (typeof auth !== "object" || auth === null) {
    throw new InvalidConfigError("auth must be an object");
  }
  const authRecord = auth as Record<string, unknown>;
  if (authRecord.method !== "basic") {
    throw new InvalidConfigError(
      `unsupported auth method: ${String(authRecord.method)}`,
    );
  }
  if (typeof authRecord.credential !== "string") {
    throw new InvalidConfigError("auth.credential must be a string");
  }
  const rulesValue = record.rules ?? [];
  if (!Array.isArray(rulesValue)) {
    throw new InvalidConfigError("rules must be an array");
  }
  const rules = rulesValue.map((rule, index) => parseHostRule(rule, index));
  const defaultAction = record.defaultAction ?? "proxy";
  if (defaultAction !== "proxy" && defaultAction !== "direct") {
    throw new InvalidConfigError(`defaultAction must be "proxy" or "direct"`);
  }
  const label = typeof record.label === "string" ? record.label : "";
  return {
    configVersion: 1,
    issuanceVersion,
    ingress: {
      hosts: hosts.map((host, index) =>
        requireHost(host, `ingress.hosts[${index}]`),
      ),
      port: requirePort(ingress.port, "ingress.port"),
    },
    auth: {
      method: "basic",
      username:
        typeof authRecord.username === "string" ? authRecord.username : "xbond",
      credential: authRecord.credential,
    },
    rules,
    defaultAction,
    label,
  };
}

/** 手动配置（管理页表单）构造入口：单 host + 单凭据的便捷路径。 */
export function buildManualConfig(input: {
  host: string;
  port: number;
  username?: string;
  credential: string;
  label?: string;
}): ExtensionConfig {
  return parseExtensionConfig({
    configVersion: 1,
    issuanceVersion: `manual-${new Date().toISOString()}`,
    ingress: { hosts: [input.host], port: input.port, tls: true },
    auth: {
      method: "basic",
      username: input.username ?? "xbond",
      credential: input.credential,
    },
    rules: [],
    defaultAction: "proxy",
    label: input.label ?? "manual",
  });
}
