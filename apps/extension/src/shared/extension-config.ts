// target=extension 订阅配置（extension-config v1）的类型与严格校验：Cloud 的
// 订阅管线签发，background 直接消费。原则 fail loud——未知版本、缺字段、
// 不可执行的节点形状一律拒绝，绝不做静默降级（错误的代理配置比没有更糟）。

export type ExtensionNode = {
  name: string;
  /** 入口 Agent 域名（harness/DNS 解析目标）。 */
  server: string;
  port: number;
  /** 节点密码 = hex(md5(tag))：407 Basic 的 password，服务端据此选出口。 */
  password: string;
};

export type ExtensionGroup = {
  name: string;
  type: "select" | "urltest";
  members: string[];
  url?: string;
  interval?: number;
};

export type ExtensionRule =
  | { kind: "ruleset"; id: string; target: string }
  | { kind: "domain-suffix"; suffixes: string[]; target: string };

export type HeadlessRule = {
  domain?: string[];
  domain_suffix?: string[];
  domain_keyword?: string[];
  ip_cidr?: string[];
};

export type ExtensionConfig = {
  version: 1;
  /** 407 Basic 的 username（服务端快照准入）。 */
  proxyToken: string;
  nodes: ExtensionNode[];
  groups: ExtensionGroup[];
  rules: ExtensionRule[];
  /** 分类 id → 裁剪后的 headless 规则（PAC 可表达的子集）。 */
  ruleSets: Record<string, HeadlessRule[]>;
  final: string;
};

export class InvalidConfigError extends Error {}

/** 内置动作名：PAC 里 DIRECT / REJECT 是不可代理的叶子。 */
export const DIRECT = "DIRECT";
export const REJECT = "REJECT";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new InvalidConfigError(`${field} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new InvalidConfigError(`${field} must be a non-empty string array`);
  }
  return value as string[];
}

function parseNode(value: unknown, index: number): ExtensionNode {
  if (!isRecord(value))
    throw new InvalidConfigError(`nodes[${index}] must be an object`);
  const port = value.port;
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new InvalidConfigError(
      `nodes[${index}].port must be an integer port`,
    );
  }
  const password = requireString(value.password, `nodes[${index}].password`);
  if (!/^[a-f0-9]{8,}$/i.test(password)) {
    throw new InvalidConfigError(
      `nodes[${index}].password must be the node password digest`,
    );
  }
  return {
    name: requireString(value.name, `nodes[${index}].name`),
    server: requireString(value.server, `nodes[${index}].server`),
    port,
    password,
  };
}

function parseGroup(value: unknown, index: number): ExtensionGroup {
  if (!isRecord(value))
    throw new InvalidConfigError(`groups[${index}] must be an object`);
  const type = value.type;
  if (type !== "select" && type !== "urltest") {
    throw new InvalidConfigError(
      `groups[${index}].type must be select or urltest`,
    );
  }
  return {
    name: requireString(value.name, `groups[${index}].name`),
    type,
    members: requireStringArray(value.members, `groups[${index}].members`),
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(typeof value.interval === "number" ? { interval: value.interval } : {}),
  };
}

function parseRule(value: unknown, index: number): ExtensionRule {
  if (!isRecord(value))
    throw new InvalidConfigError(`rules[${index}] must be an object`);
  const target = requireString(value.target, `rules[${index}].target`);
  if (value.kind === "ruleset") {
    return {
      kind: "ruleset",
      id: requireString(value.id, `rules[${index}].id`),
      target,
    };
  }
  if (value.kind === "domain-suffix") {
    return {
      kind: "domain-suffix",
      suffixes: requireStringArray(value.suffixes, `rules[${index}].suffixes`),
      target,
    };
  }
  throw new InvalidConfigError(
    `rules[${index}].kind must be ruleset or domain-suffix`,
  );
}

function parseHeadlessRules(value: unknown, id: string): HeadlessRule[] {
  if (!Array.isArray(value))
    throw new InvalidConfigError(`ruleSets.${id} must be an array`);
  return value.map((entry, index) => {
    if (!isRecord(entry))
      throw new InvalidConfigError(
        `ruleSets.${id}[${index}] must be an object`,
      );
    const rule: HeadlessRule = {};
    for (const key of [
      "domain",
      "domain_suffix",
      "domain_keyword",
      "ip_cidr",
    ] as const) {
      if (entry[key] !== undefined) {
        rule[key] = requireStringArray(
          entry[key],
          `ruleSets.${id}[${index}].${key}`,
        );
      }
    }
    return rule;
  });
}

/** 归一订阅响应为 ExtensionConfig v1；任何不合规输入都抛 InvalidConfigError。 */
export function parseExtensionConfig(input: unknown): ExtensionConfig {
  if (!isRecord(input))
    throw new InvalidConfigError("config must be an object");
  if (input.version !== 1) {
    throw new InvalidConfigError(
      `unsupported version: ${String(input.version)}`,
    );
  }
  const proxyToken = requireString(input.proxyToken, "proxyToken");
  if (!/^px-[a-f0-9]{48}$/i.test(proxyToken)) {
    throw new InvalidConfigError("proxyToken must be the px- credential");
  }
  if (!Array.isArray(input.nodes) || input.nodes.length === 0) {
    throw new InvalidConfigError("nodes must be a non-empty array");
  }
  if (!Array.isArray(input.groups))
    throw new InvalidConfigError("groups must be an array");
  if (!Array.isArray(input.rules))
    throw new InvalidConfigError("rules must be an array");
  if (!isRecord(input.ruleSets))
    throw new InvalidConfigError("ruleSets must be an object");
  const ruleSets: Record<string, HeadlessRule[]> = {};
  for (const [id, rules] of Object.entries(input.ruleSets)) {
    ruleSets[id] = parseHeadlessRules(rules, id);
  }
  return {
    version: 1,
    proxyToken,
    nodes: input.nodes.map(parseNode),
    groups: input.groups.map(parseGroup),
    rules: input.rules.map(parseRule),
    ruleSets,
    final: requireString(input.final, "final"),
  };
}

/** subscription-userinfo 头解析（余量/到期）：`k=v; k=v`。 */
export type Quota = {
  uploadBytes: number;
  downloadBytes: number;
  totalBytes: number;
  /** epoch 秒。 */
  expiresAt: number;
};

export function parseUserInfo(header: string | null): Quota | null {
  if (!header) return null;
  const values: Record<string, number> = {};
  for (const part of header.split(";")) {
    const [rawKey, rawValue] = part.split("=");
    const key = rawKey?.trim();
    const value = Number(rawValue);
    if (key && Number.isFinite(value)) values[key] = value;
  }
  if (values.total === undefined || values.expire === undefined) return null;
  return {
    uploadBytes: values.upload ?? 0,
    downloadBytes: values.download ?? 0,
    totalBytes: values.total,
    expiresAt: values.expire,
  };
}
