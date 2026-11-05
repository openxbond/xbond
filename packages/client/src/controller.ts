export interface Controller {
  id: string;
  name: string;
  url: string;
  secret: string;
}

export type Endpoint = Pick<Controller, "url" | "secret">;

/**
 * 用戶選中的控制目標。本機 daemon 是宿主身份，不佔用外部控制器列表的條目；
 * 選擺了不存在的跨界 id 時由解析回落。
 */
export type TargetSelection =
  | { kind: "daemon" }
  | { kind: "controller"; id: string };

/**
 * 解析後的控制目標。daemon 分支沒有 controller 欄位——佔位地址不存在於
 * 類型上；endpoint 只有 daemon 廣播（status）或注入 meta 時才可信，離線為
 * null。"none" 表示沒有任何可用目標（純 Web 且未保存外部控制器）。
 */
export type ControlTarget =
  | { kind: "daemon"; endpoint: Endpoint | null }
  | { kind: "controller"; controller: Controller; endpoint: Endpoint }
  | { kind: "none" };

export interface ControlLaunch {
  /** daemon 服務頁注入的 `external-controller` meta（含憑據）。 */
  meta?: string;
  /** 啟動參數：host 必須存在才視為指定外部控制器。 */
  search?: string;
  /** ClashX 等宿主橋接，優先於啟動參數。 */
  bridge?: Controller | null;
  /** 宿主聲明的本機 daemon；core 來自 LocalAPI status 的隨機端點。 */
  daemon?: { core?: Endpoint } | null;
}

/**
 * 解析有效控制目標。順序：宿主橋接 > 啟動參數 > 用戶選擇 > 回落。
 * 規格見 docs/specs/control-targets.md「有效目標解析」。
 */
export function resolveControlTarget(
  externals: Controller[],
  selection: TargetSelection,
  launch: ControlLaunch = {},
): ControlTarget {
  if (launch.bridge)
    return {
      kind: "controller",
      controller: launch.bridge,
      endpoint: launch.bridge,
    };

  // 啟動參數指定外部核心控制器：即使當前選本機，也不繼承本機能力與憑據。
  const query = new URLSearchParams(launch.search);
  if (query.has("host")) {
    try {
      const controller = controllerFromQuery(query);
      return {
        kind: "controller",
        controller,
        endpoint: controller,
      };
    } catch {
      // 無效啟動參數保留原目標。
    }
  }

  if (selection.kind === "controller") {
    const controller = externals.find((item) => item.id === selection.id);
    if (controller)
      return { kind: "controller", controller, endpoint: controller };
  }

  // 本機身份：宿主聲明 daemon 時，選本機或選中項缺失都落回本機。endpoint
  // 只有 status 廣播或注入 meta 才可信，兩者都缺席（離線）時為 null。
  if (launch.daemon) {
    if (launch.meta) {
      try {
        return { kind: "daemon", endpoint: metaEndpoint(launch.meta) };
      } catch {
        // 無效 meta 視同缺席。
      }
    }
    return { kind: "daemon", endpoint: launch.daemon.core ?? null };
  }

  // 純 Web：沒有 daemon 身份，回落到已保存的外部控制器，否則無目標。
  const fallback = externals[0];
  if (fallback)
    return { kind: "controller", controller: fallback, endpoint: fallback };
  return { kind: "none" };
}

/** 啟動參數目標的確定性 id：頁面內穩定，且不與真實保存的 id 衝突。 */
const LAUNCH_CONTROLLER_ID = "launch";

function controllerFromQuery(query: URLSearchParams): Controller {
  const host = query.get("host")?.trim();
  if (!host) throw new Error("host is required");
  const rawPort = query.get("port") ?? "";
  const port = validPort(rawPort) ? Number(rawPort) : 9090;
  const protocol =
    query.get("protocol")?.replace(/:$/, "") === "https" ? "https" : "http";
  const bracketed =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return {
    id: LAUNCH_CONTROLLER_ID,
    name: "",
    url: normalizeControllerURL(`${protocol}://${bracketed}:${port}`),
    // 端點改變而沒有明確提供新憑據時，不繼承上一目標的憑據。
    secret: query.get("secret") ?? "",
  };
}

function metaEndpoint(content: string): Endpoint {
  const url = new URL(content);
  // daemon 注入 `http://:<secret>@host`；其他面板把 secret 放用戶名位。都收。
  const secret = decodeURIComponent(url.password || url.username);
  url.username = "";
  url.password = "";
  return { url: normalizeControllerURL(url.toString()), secret };
}

/**
 * 清洗外部控制器列表：丟棄壞記錄與混入的本機身份副本（舊版把它種進列表，
 * 且改過 id 的副本會以幽靈姿態復活）。
 */
export function migrateExternals(value: unknown): Controller[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const controllers: Controller[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    try {
      const record = item as Record<string, unknown>;
      const rawURL =
        typeof record.url === "string" && record.url
          ? record.url
          : typeof record.hostname === "string" && record.hostname
            ? `http://${
                record.hostname.includes(":") &&
                !record.hostname.startsWith("[")
                  ? `[${record.hostname}]`
                  : record.hostname
              }:${validPort(String(record.port ?? "")) ? Number(record.port) : 9090}`
            : "";
      if (!rawURL) continue;
      const url = normalizeControllerURL(rawURL);
      // 內建種子的形態（無密鑰 + XBond/空名 + 佔位端口）：直接丟棄，不復活。
      const builtInSeed =
        !record.secret &&
        (record.name === "XBond" || record.name === "") &&
        (url === "http://127.0.0.1:9090" || url === "http://localhost:9090");
      if (builtInSeed) continue;
      // 佔用內建 id 的真實記錄保留，但重新賦 id——"default" 只屬於本機身份。
      const id =
        typeof record.id === "string" &&
        record.id &&
        record.id !== "default" &&
        !ids.has(record.id)
          ? record.id
          : createControllerId();
      ids.add(id);
      controllers.push({
        id,
        name: String(record.name ?? ""),
        url,
        secret: String(record.secret ?? ""),
      });
    } catch {
      /* 壞記錄不阻斷啟動。 */
    }
  }
  return controllers;
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
