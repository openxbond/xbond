export interface Controller {
  id: string;
  name: string;
  url: string;
  secret: string;
}

export interface ControlTarget {
  kind: "daemon" | "controller";
  controller: Controller;
  /**
   * The daemon's live endpoint can rotate independently of its identity.
   * Null while a daemon target has no verified endpoint: a missing LocalAPI
   * status must not send requests to the saved placeholder address.
   */
  endpoint: Pick<Controller, "url" | "secret"> | null;
}

/** Resolve the effective target before granting local runtime operations. */
export function resolveControlTarget(
  saved: Controller,
  launch: {
    meta?: string;
    search?: string;
    bridge?: Controller | null;
    daemon?: {
      id: string;
      core?: Pick<Controller, "url" | "secret">;
      verifiedMeta?: string;
    } | null;
  } = {},
): ControlTarget {
  let controller = saved;
  let kind: ControlTarget["kind"] =
    launch.daemon && saved.id === launch.daemon.id ? "daemon" : "controller";
  if (launch.meta) {
    try {
      controller = controllerFromMeta(launch.meta, controller);
      kind =
        kind === "daemon" &&
        (launch.meta === launch.daemon?.verifiedMeta ||
          !launch.daemon?.core ||
          (controller.url === launch.daemon.core.url &&
            controller.secret === launch.daemon.core.secret))
          ? "daemon"
          : "controller";
    } catch {
      // Invalid launch metadata does not replace a usable saved target.
    }
  }
  if (launch.bridge)
    return {
      kind: "controller",
      controller: launch.bridge,
      endpoint: launch.bridge,
    };
  const query = new URLSearchParams(launch.search);
  if (["host", "port", "protocol", "secret"].some((key) => query.has(key))) {
    try {
      controller = controllerFromQuery(launch.search ?? "", controller);
      kind = "controller";
    } catch {
      // Preserve the preceding target when launch parameters are invalid.
    }
  }
  return {
    kind,
    controller,
    // A daemon endpoint is real only when the daemon advertised it (core) or
    // injected it via meta. Until then the local target has no endpoint, so
    // offline transport waits instead of guessing the saved placeholder.
    endpoint:
      kind === "daemon"
        ? (launch.daemon?.core ?? (launch.meta ? controller : null))
        : controller,
  };
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

export function controllerFromMeta(
  content: string,
  fallback: Controller,
): Controller {
  const url = new URL(content);
  // The daemon injects `http://:<secret>@host`, which URL parses as an empty
  // username and the secret as the password; other dashboards put the secret
  // in the username position. Accept both.
  const secret = decodeURIComponent(url.password || url.username);
  url.username = "";
  url.password = "";
  return {
    ...fallback,
    url: normalizeControllerURL(url.toString()),
    secret,
  };
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
      const isFallbackDuplicate =
        (item.name === fallback.name ||
          item.id === fallback.id ||
          item.id === "default") &&
        (url === fallback.url ||
          url === "http://127.0.0.1:9090" ||
          url === "http://localhost:9090" ||
          url === "") &&
        !item.secret;
      if (isFallbackDuplicate && value.length > 1) {
        // 存在其他真实条目时丢弃过期的内置副本。
        continue;
      }
      if (isFallbackDuplicate) {
        // 唯一条目即内置 daemon 身份：归位到 fallback，绝不改名换姓——
        // 否则持久化过的内置项在下次启动时丢失 daemon 关联，变成幽灵控制器。
        ids.add(fallback.id);
        controllers.push({ ...fallback });
        continue;
      }
      const id =
        typeof item.id === "string" &&
        item.id !== fallback.id &&
        !ids.has(item.id)
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
  const resolvedURL = normalizeControllerURL(url.toString());
  return {
    ...fallback,
    url: resolvedURL,
    // A launch URL that changes targets cannot borrow the previous target's
    // credential, including a private daemon credential injected by meta.
    secret:
      qs.get("secret") ??
      (resolvedURL === normalizeControllerURL(fallback.url)
        ? fallback.secret
        : ""),
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
