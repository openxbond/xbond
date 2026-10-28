export interface CoreVersion {
  version: string;
  premium?: boolean;
  meta?: boolean;
}
export interface CoreCapabilities {
  kind: "sing-box" | "clash" | "mihomo" | "unknown";
  editPorts: boolean;
  editLan: boolean;
  reloadConfig: boolean;
  proxyProviders: boolean;
  ruleProviders: boolean;
  dns: boolean;
  flushCache: boolean;
  memory: boolean;
  groupDelay: boolean;
  modes: string[];
}
export function coreCapabilities(
  core: CoreVersion,
  modeList?: string[],
): CoreCapabilities {
  const version = core.version.toLowerCase();
  const sing = version.includes("sing-box");
  const known = !!version;
  const meta = !sing && (!!core.meta || /mihomo|meta/.test(version));
  return {
    kind: sing ? "sing-box" : meta ? "mihomo" : known ? "clash" : "unknown",
    editPorts: known && !sing,
    editLan: known && !sing,
    reloadConfig: known && !sing,
    proxyProviders: known && !sing,
    ruleProviders: known && !sing && (!!core.premium || meta),
    dns: known,
    flushCache: sing,
    memory: sing || meta,
    groupDelay: sing || meta,
    modes: modeList?.length
      ? [...new Set(modeList)]
      : [
          "global",
          "rule",
          "direct",
          ...(!sing && core.premium ? ["script"] : []),
        ],
  };
}
