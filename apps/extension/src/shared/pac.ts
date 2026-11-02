// PAC 编译（纯函数）：把 extension-config 的规则与策略组编译成 Chromium PAC。
//
// 语义（客户端规格 docs/specs/extension-host.md）：
// - 先到先得：规则顺序即优先级，命中优先级最小的条目即返回；
// - O(1) 索引：精确域名与后缀各一张哈希表（按标签后缀逐级查找），关键字线性
//   扫描（关键字天然无法哈希）；每次请求 3~4 次查找；
// - 只保留可被 PAC 忠实表达的条件：domain / domain_suffix / domain_keyword，
//   以及 Lan 分类的 IPv4 ip_cidr（内网直连需要 isInNet；IPv6 段 PAC 无法表达，
//   直接剔除并留注释）；
// - 组解析复用 workspace 的链式规则；每个出口渲染成「节点密码前缀子域」的
//   代理串（见 workspace.leafToProxyString）；
// - 不做静默直连兜底：未命中规则走 final 的解析结果，REJECT 以本地无监听端口
//   立即失败；凭据（proxyToken 与完整节点密码）绝不进入 PAC 文本。

import {
  DIRECT,
  type ExtensionConfig,
  type HeadlessRule,
} from "./extension-config.ts";
import {
  leafToProxyString,
  resolveLeaf,
  resolvePrimary,
  type Selection,
} from "./workspace.ts";

type Entry =
  | { kind: "domain"; domain: string; priority: number; action: string }
  | { kind: "domain-suffix"; suffix: string; priority: number; action: string }
  | {
      kind: "domain-keyword";
      keyword: string;
      priority: number;
      action: string;
    }
  | { kind: "ip-cidr"; cidr: string; priority: number; action: string };

/** CIDR（IPv4）→ isInNet 的网络地址与点分掩码；非 IPv4 返回 null。 */
function cidrToMask(cidr: string): { network: string; mask: string } | null {
  const [address, prefixRaw] = cidr.split("/");
  if (address === undefined || prefixRaw === undefined) return null;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return null;
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const octets = address.split(".").map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return null;
  const maskValue = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const mask = [24, 16, 8, 0]
    .map((shift) => (maskValue >>> shift) & 0xff)
    .join(".");
  const network = octets
    .map((octet, index) => octet & ((maskValue >>> (24 - index * 8)) & 0xff))
    .join(".");
  return { network, mask };
}

/** PAC 的 host 为 punycode/ASCII：非 ASCII 规则条目永远匹配不上，直接丢弃。 */
function asciiOnly(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7f]+$/.test(value);
}

/** 一条 headless 规则 → 若干匹配条目（同一优先级）。 */
function expandHeadless(
  rule: HeadlessRule,
  priority: number,
  action: string,
): Entry[] {
  const entries: Entry[] = [];
  for (const domain of rule.domain ?? []) {
    if (!asciiOnly(domain)) continue;
    entries.push({
      kind: "domain",
      domain: domain.toLowerCase(),
      priority,
      action,
    });
  }
  for (const suffix of rule.domain_suffix ?? []) {
    if (!asciiOnly(suffix)) continue;
    entries.push({
      kind: "domain-suffix",
      suffix: suffix.toLowerCase(),
      priority,
      action,
    });
  }
  for (const keyword of rule.domain_keyword ?? []) {
    if (!asciiOnly(keyword)) continue;
    entries.push({
      kind: "domain-keyword",
      keyword: keyword.toLowerCase(),
      priority,
      action,
    });
  }
  for (const cidr of rule.ip_cidr ?? []) {
    entries.push({ kind: "ip-cidr", cidr, priority, action });
  }
  return entries;
}

type CompiledIndex = {
  exact: Map<string, { priority: number; action: string }>;
  suffix: Map<string, { priority: number; action: string }>;
  keyword: Array<{ keyword: string; priority: number; action: string }>;
  cidrs: Array<{
    network: string;
    mask: string;
    priority: number;
    action: string;
  }>;
};

function keepLowest(
  map: Map<string, { priority: number; action: string }>,
  key: string,
  priority: number,
  action: string,
): void {
  const existing = map.get(key);
  if (!existing || priority < existing.priority) {
    map.set(key, { priority, action });
  }
}

/** 按规则顺序展开为全局优先级序列。 */
export function compileEntries(
  config: ExtensionConfig,
  selection: Selection,
): Entry[] {
  const entries: Entry[] = [];
  let priority = 0;
  for (const rule of config.rules) {
    if (rule.kind === "domain-suffix") {
      const action = leafToProxyString(
        resolveLeaf(config, selection, rule.target),
      );
      for (const suffix of rule.suffixes) {
        entries.push({
          kind: "domain-suffix",
          suffix: suffix.toLowerCase(),
          priority,
          action,
        });
      }
      priority += 1;
      continue;
    }
    const action = leafToProxyString(
      resolveLeaf(config, selection, rule.target),
    );
    for (const headless of config.ruleSets[rule.id] ?? []) {
      entries.push(...expandHeadless(headless, priority, action));
    }
    priority += 1;
  }
  return entries;
}

function buildIndex(entries: Entry[]): CompiledIndex {
  const index: CompiledIndex = {
    exact: new Map(),
    suffix: new Map(),
    keyword: [],
    cidrs: [],
  };
  for (const entry of entries) {
    switch (entry.kind) {
      case "domain":
        keepLowest(index.exact, entry.domain, entry.priority, entry.action);
        break;
      case "domain-suffix":
        keepLowest(index.suffix, entry.suffix, entry.priority, entry.action);
        break;
      case "domain-keyword":
        index.keyword.push({
          keyword: entry.keyword,
          priority: entry.priority,
          action: entry.action,
        });
        break;
      case "ip-cidr": {
        const parsed = cidrToMask(entry.cidr);
        // IPv6 / 非法 CIDR：PAC 无法可靠表达，剔除（服务端已裁剪过，这里防御性再挡）。
        if (parsed) {
          index.cidrs.push({
            ...parsed,
            priority: entry.priority,
            action: entry.action,
          });
        }
        break;
      }
    }
  }
  index.keyword.sort((a, b) => a.priority - b.priority);
  return index;
}

function jsLiteral(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * 生成规则模式 PAC：先到先得 + O(1) 索引 + Lan 内网直连。bypassHosts 是控制
 * 通道（订阅源）域名：PAC 模式不支持 bypassList，必须显式放行，否则入口故障
 * 时订阅刷新会跟着断（自愈链断裂）。
 */
export function generatePacSource(
  config: ExtensionConfig,
  selection: Selection,
  bypassHosts: string[] = [],
): string {
  const index = buildIndex(compileEntries(config, selection));
  const fallback = leafToProxyString(
    resolveLeaf(config, selection, config.final),
  );

  const exactObject: Record<string, [number, string]> = {};
  for (const [domain, hit] of index.exact)
    exactObject[domain] = [hit.priority, hit.action];
  const suffixObject: Record<string, [number, string]> = {};
  for (const [suffix, hit] of index.suffix)
    suffixObject[suffix] = [hit.priority, hit.action];
  const keywordArray = index.keyword.map((item) => [
    item.priority,
    item.keyword,
    item.action,
  ]);
  const cidrArray = index.cidrs.map((item) => [
    item.priority,
    item.network,
    item.mask,
    item.action,
  ]);

  const bypassObject: Record<string, true> = {};
  for (const host of bypassHosts) bypassObject[host.toLowerCase()] = true;
  return `// XBond PAC - generated from the subscription; first match wins, no silent DIRECT fallback.
function FindProxyForURL(url, host) {
  var h = (host || "").toLowerCase();
  if (BYPASS[h]) return "DIRECT"; // control channel: the subscription host stays direct
  var best = null; // [priority, action]
  function consider(hit) { if (hit !== undefined && (best === null || hit[0] < best[0])) best = hit; }

  consider(EXACT[h]);
  consider(SUFFIX[h]);
  // suffix walk: a.b.example.com -> a.b.example.com / b.example.com / example.com / com
  var dot = h.indexOf(".");
  while (dot !== -1) {
    consider(SUFFIX[h.slice(dot + 1)]);
    dot = h.indexOf(".", dot + 1);
  }
  for (var i = 0; i < KEYWORDS.length; i++) {
    if (h.indexOf(KEYWORDS[i][1]) !== -1) { consider([KEYWORDS[i][0], KEYWORDS[i][2]]); break; }
  }
  for (var j = 0; j < CIDRS.length; j++) {
    if (isInNet(host, CIDRS[j][1], CIDRS[j][2])) { consider([CIDRS[j][0], CIDRS[j][3]]); break; }
  }
  return best !== null ? best[1] : ${jsLiteral(fallback)};
}
var EXACT = ${jsLiteral(exactObject)};
var SUFFIX = ${jsLiteral(suffixObject)};
var KEYWORDS = ${jsLiteral(keywordArray)};
var CIDRS = ${jsLiteral(cidrArray)};
var BYPASS = ${jsLiteral(bypassObject)};
`;
}

/** 生成全局模式 PAC：主选择组的叶子接管一切流量；控制通道直连。 */
export function generateGlobalPacSource(
  config: ExtensionConfig,
  selection: Selection,
  bypassHosts: string[] = [],
  target?: string,
): string {
  const primary = leafToProxyString(
    target
      ? resolveLeaf(config, selection, target)
      : resolvePrimary(config, selection),
  );
  const bypassObject: Record<string, true> = {};
  for (const host of bypassHosts) bypassObject[host.toLowerCase()] = true;
  return `// XBond PAC (global)
var BYPASS = ${jsLiteral(bypassObject)};
function FindProxyForURL(url, host) {
  if (BYPASS[(host || "").toLowerCase()]) return "DIRECT";
  return ${jsLiteral(primary)};
}
`;
}

/**
 * 凭据守卫：PAC 文本不得包含 proxyToken 或完整节点密码。节点密码前缀是设计
 * 的一部分（子域隔离认证缓存），完整凭据只允许出现在 storage 与
 * onAuthRequired 应答里。
 */
export function assertPacContainsNoCredentials(
  source: string,
  config: ExtensionConfig,
): void {
  if (source.includes(config.proxyToken)) {
    throw new Error("PAC must never contain the proxy token");
  }
  for (const node of config.nodes) {
    if (source.includes(node.password)) {
      throw new Error(
        `PAC must never contain the full node password (${node.name})`,
      );
    }
  }
}

/** pacScript.data 只接受 ASCII（Chromium 会 decodeURIComponent 后再解析）：
 * 模板与数据均已保持 ASCII，这里对任何残留做百分号编码兜底。 */
export function toPacPayload(source: string): string {
  return /[^ -]/.test(source) ? encodeURIComponent(source) : source;
}

export { DIRECT };
