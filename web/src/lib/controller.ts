export interface Controller {
  id: string;
  name: string;
  url: string;
  secret: string;
}

let sequence = 0;
// LAN HTTP controllers are not secure contexts, so randomUUID may be absent.
export function createControllerId() {
  if (typeof globalThis.crypto?.randomUUID === "function")
    return crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === "function")
    return Array.from(crypto.getRandomValues(new Uint32Array(4)), (word) =>
      word.toString(16).padStart(8, "0"),
    ).join("");
  return `controller-${Date.now()}-${++sequence}`;
}

export function normalizeControllerURL(value: string): string {
  const url = new URL(value.includes("://") ? value : `http://${value}`);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid controller URL");
  return url.toString().replace(/\/+$/, "");
}

export function migrateControllers(
  value: unknown,
  fallback: Controller,
): Controller[] {
  if (!Array.isArray(value)) return [fallback];
  const ids = new Set<string>();
  const controllers: Controller[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    try {
      const host = String(item.hostname ?? "");
      const hostname =
        host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
      const url = normalizeControllerURL(
        item.url ?? `http://${hostname}:${item.port ?? 9090}`,
      );
      const id =
        typeof item.id === "string" && !ids.has(item.id)
          ? item.id
          : createControllerId();
      ids.add(id);
      controllers.push({
        id,
        name: String(item.name ?? ""),
        url,
        secret: String(item.secret ?? ""),
      });
    } catch {
      /* A corrupt profile must not prevent startup. */
    }
  }
  return controllers.length ? controllers : [fallback];
}

export function controllerFromQuery(
  search: string,
  fallback: Controller,
): Controller {
  const qs = new URLSearchParams(search);
  const url = new URL(fallback.url);
  if (qs.has("host")) {
    const host = qs.get("host")!.trim();
    url.hostname =
      host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  }
  if (qs.has("port")) url.port = qs.get("port")!;
  const protocol = qs.get("protocol")?.replace(/:$/, "");
  if (protocol === "http" || protocol === "https")
    url.protocol = `${protocol}:`;
  return {
    ...fallback,
    url: normalizeControllerURL(url.toString()),
    secret: qs.get("secret") ?? fallback.secret,
  };
}

export function streamURL(base: string, path: string, secret: string) {
  const url = new URL(`${base.replace(/\/+$/, "")}/${path}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", secret);
  return url.toString();
}

export function validPort(value: string | number) {
  return (
    /^\d+$/.test(String(value)) && Number(value) >= 0 && Number(value) <= 65535
  );
}
