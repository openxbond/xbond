import type { ExtensionConfig } from "./extension-config.ts";
import { compileEntries } from "./pac.ts";
import { leafToProxyString, resolveLeaf, type Selection } from "./workspace.ts";

export interface WebsiteOverride {
  id: string;
  domain: string;
  match: "exact" | "suffix";
  target: string;
  enabled: boolean;
}

export function normalizeDomain(input: string): string {
  const value = input.trim().replace(/\.$/, "");
  if (!value || /[\s/:@?#\\[\]*]/.test(value))
    throw new Error("Enter a domain without a URL, port or path");
  const domain = new URL(`https://${value}`).hostname.toLowerCase();
  if (
    domain.length > 253 ||
    domain
      .split(".")
      .some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
  ) {
    throw new Error("Invalid domain name");
  }
  return domain;
}

export function withOverrides(
  config: ExtensionConfig,
  overrides: WebsiteOverride[],
): ExtensionConfig {
  const ruleSets = { ...config.ruleSets };
  const rules: ExtensionConfig["rules"] = [];
  const ordered = overrides
    .filter((rule) => rule.enabled)
    .sort(
      (a, b) =>
        Number(b.match === "exact") - Number(a.match === "exact") ||
        b.domain.length - a.domain.length,
    );
  for (const override of ordered) {
    resolveLeaf(config, {}, override.target);
    const domain = normalizeDomain(override.domain);
    let id = `__xbond_browser_${override.id}`;
    while (id in ruleSets) id = `_${id}`;
    ruleSets[id] = [
      override.match === "exact"
        ? { domain: [domain] }
        : { domain_suffix: [domain] },
    ];
    rules.push({ kind: "ruleset", id, target: override.target });
  }
  return { ...config, rules: [...rules, ...config.rules], ruleSets };
}

function ipv4(value: string): number | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return null;
  const parts = value.split(".").map(Number);
  if (parts.some((n) => n > 255)) return null;
  return parts.reduce((n, part) => (n * 256 + part) >>> 0, 0);
}

export function predictRoute(
  config: ExtensionConfig,
  selection: Selection,
  input: string,
) {
  const host = normalizeDomain(input);
  const entry = compileEntries(config, selection).find((candidate) => {
    switch (candidate.kind) {
      case "domain":
        return candidate.domain === host;
      case "domain-suffix":
        return (
          host === candidate.suffix || host.endsWith(`.${candidate.suffix}`)
        );
      case "domain-keyword":
        return host.includes(candidate.keyword);
      case "ip-cidr": {
        const address = ipv4(host);
        const [network, prefixRaw] = candidate.cidr.split("/");
        const networkAddress = ipv4(network);
        const prefix = Number(prefixRaw);
        if (
          address === null ||
          networkAddress === null ||
          !Number.isInteger(prefix) ||
          prefix < 0 ||
          prefix > 32
        )
          return false;
        const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
        return (address & mask) === (networkAddress & mask);
      }
    }
  });
  const target = entry
    ? (config.rules[entry.priority]?.target ?? config.final)
    : config.final;
  const path = selectionPath(config, selection, target);
  const leaf = resolveLeaf(config, selection, target);
  return {
    host,
    source: entry ? ("rule" as const) : ("final" as const),
    target,
    path,
    action: leafToProxyString(leaf),
    condition: entry?.kind ?? "final",
    dnsLimited: !entry && ipv4(host) === null,
  };
}
export function selectionPath(
  config: ExtensionConfig,
  selection: Selection,
  target: string,
): string[] {
  const path = [target];
  const visited = new Set(path);
  let current = target;
  for (;;) {
    const group = config.groups.find((g) => g.name === current);
    if (!group) break;
    const member =
      selection[current] && group.members.includes(selection[current])
        ? selection[current]
        : group.members.find((name) => name !== current);
    if (!member || visited.has(member)) break;
    path.push(member);
    visited.add(member);
    current = member;
  }
  return path;
}
