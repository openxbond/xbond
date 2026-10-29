import type { Group, Proxy } from "./request.ts";

export function controllerIdentity(id: string, address: string): string {
  const url = new URL(address);
  return JSON.stringify([id, url.origin, url.pathname]);
}

export function isDaemonController(address: string, port?: number): boolean {
  if (!port) return false;
  const url = new URL(address);
  return (
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    Number(url.port || (url.protocol === "https:" ? 443 : 80)) === port
  );
}

export function workspaceLink(
  search: string,
  pathname: string,
  values: Record<string, string> = {},
) {
  const params = new URLSearchParams(search);
  for (const name of ["section", "view", "group", "track"]) params.delete(name);
  for (const [name, value] of Object.entries(values)) params.set(name, value);
  return { pathname, search: params.toString() ? `?${params}` : "" };
}

export function focusedGroup(groups: Group[], saved?: string): Group | null {
  if (saved) return groups.find((group) => group.name === saved) ?? null;
  return groups.length === 1 ? groups[0] : null;
}

export function strategyPath(
  group: Group | null,
  mapping: ReadonlyMap<string, Group | Proxy>,
): string[] {
  if (!group) return [];
  const path = [group.name];
  let next = group.now;
  while (next && !path.includes(next)) {
    path.push(next);
    const item = mapping.get(next);
    next = item && "now" in item ? item.now : "";
  }
  return path;
}
