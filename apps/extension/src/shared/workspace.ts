// 策略组解析（与 client-ui 的 workspace 语义同构）：组 → 选中成员 → 递归，
// 直到命中内置动作（DIRECT/REJECT）或具体节点。PAC 编译与认证匹配都吃同一
// 份解析结果；循环引用视为配置错误（fail loud，不做任意截断）。

import {
  DIRECT,
  REJECT,
  type ExtensionConfig,
  type ExtensionGroup,
  type ExtensionNode,
} from "./extension-config.ts";

export type Selection = Record<string, string>;

export type Leaf =
  | { kind: "direct" }
  | { kind: "reject" }
  | { kind: "node"; node: ExtensionNode };

export class ResolveError extends Error {}

/** 组名 → 组；节点名 → 节点；内置动作单列。 */
export function buildIndex(config: ExtensionConfig): {
  groups: Map<string, ExtensionGroup>;
  nodes: Map<string, ExtensionNode>;
} {
  return {
    groups: new Map(config.groups.map((group) => [group.name, group])),
    nodes: new Map(config.nodes.map((node) => [node.name, node])),
  };
}

/**
 * 解析目标到叶子：内置动作直接返回；组按 selection（缺省取首个可解析成员，
 * select 组缺省第一个成员、urltest 组缺省由客户端侧自动选择——扩展先把
 * urltest 视作取首个成员）。成员缺失或循环引用抛 ResolveError。
 */
export function resolveLeaf(
  config: ExtensionConfig,
  selection: Selection,
  target: string,
): Leaf {
  const { groups, nodes } = buildIndex(config);
  const visiting = new Set<string>();
  let current = target;
  for (;;) {
    if (current === DIRECT) return { kind: "direct" };
    if (current === REJECT) return { kind: "reject" };
    const node = nodes.get(current);
    if (node) return { kind: "node", node };
    if (visiting.has(current)) {
      throw new ResolveError(`group cycle at "${current}"`);
    }
    visiting.add(current);
    const group = groups.get(current);
    if (!group) {
      throw new ResolveError(`unknown target "${current}"`);
    }
    const selected = selection[group.name];
    if (selected !== undefined && group.members.includes(selected)) {
      current = selected;
      continue;
    }
    // 缺省：取第一个能解析的成员（跳过指向自身的引用）。
    const fallback = group.members.find((member) => member !== group.name);
    if (fallback === undefined) {
      throw new ResolveError(`group "${group.name}" has no usable member`);
    }
    current = fallback;
  }
}

/**
 * 全局/直连模式的「主节点」：第一个 select 类型组的解析结果——骨架里它就是
 * 用户在「节点选择」里的选择；没有 select 组时用 final。
 */
export function resolvePrimary(
  config: ExtensionConfig,
  selection: Selection,
): Leaf {
  const primary = config.groups.find((group) => group.type === "select");
  return resolveLeaf(config, selection, primary?.name ?? config.final);
}

/** 叶子 → PAC 代理串；节点用 password 前缀做子域，隔离 Chromium 的认证缓存。 */
export function leafToProxyString(leaf: Leaf): string {
  switch (leaf.kind) {
    case "direct":
      return DIRECT;
    case "reject":
      // 本地无监听的端口：浏览器对目标的连接立即失败（REJECT 语义），
      // 不产生任何外部请求。
      return "PROXY 127.0.0.1:65535";
    case "node":
      // {password.slice(0,12)}.{server}:{port}：同一入口按子域隔开认证缓存与
      // 连接池，使不同节点出口可以在浏览器内并行；服务端只按 SNI 后缀命中
      // 可信域名，不读取前缀。
      return `HTTPS ${leaf.node.password.slice(0, 12)}.${leaf.node.server}:${leaf.node.port}`;
  }
}
