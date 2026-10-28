/**
 * LocalAPI client for communication with xbond daemon.
 *
 * Provides typed access to local daemon status, engine up/down,
 * mode switches, and subscription management.
 */

export interface LocalAPIEngineStatus {
  running: boolean;
  pid: number;
  mixedPort: number;
  clashPort: number;
  uptime: string;
  configPath: string;
}

export type TakeoverMode = "sysproxy" | "tun" | "port";
export type RoutingMode = "rule" | "global" | "direct";

export interface LocalAPIPreferences {
  takeoverMode: TakeoverMode;
  routingMode: RoutingMode;
  mixedPort: number;
  allowLan: boolean;
  clashPort: number;
  clashSecret?: string;
}

export interface TierItem {
  ok: boolean;
  label: string;
  detail: string;
}

export interface ThreeTierStatus {
  core: TierItem;
  takeover: TierItem;
  egress: TierItem;
  ready: boolean;
  interceptNote: string;
}

export interface SubscriptionMeta {
  id: string;
  name: string;
  type: "xbond" | "universal";
  urlOrFile?: string;
  token?: string;
  upload: number;
  download: number;
  total: number;
  expire: number;
  autoUpdate: boolean;
  updateIntervalHours: number;
  lastUpdated: number;
  lastEtag?: string;
  lastHash?: string;
}

export function subscriptionQuota(
  meta: Pick<SubscriptionMeta, "upload" | "download" | "total"> | null,
) {
  if (
    !meta ||
    ![meta.upload, meta.download, meta.total].every(Number.isFinite) ||
    meta.upload < 0 ||
    meta.download < 0 ||
    meta.total <= 0
  )
    return null;
  const used = meta.upload + meta.download;
  if (!Number.isFinite(used)) return null;
  const remaining = Math.max(0, meta.total - used);
  return { used, remaining, remainingPercent: (remaining / meta.total) * 100 };
}

interface SubscriptionWire extends Omit<
  SubscriptionMeta,
  "upload" | "download" | "total" | "expire" | "lastUpdated"
> {
  quota?: {
    uploadBytes: number;
    downloadBytes: number;
    totalBytes: number;
    expireUnix: number;
  };
  sourceUrl?: string;
  lastUpdatedAt?: string;
  upload?: number;
  download?: number;
  total?: number;
  expire?: number;
  lastUpdated?: number;
}

function normalizeSubscription(meta: SubscriptionWire): SubscriptionMeta {
  const timestamp = meta.lastUpdatedAt
    ? Date.parse(meta.lastUpdatedAt) / 1000
    : 0;
  return {
    ...meta,
    urlOrFile: meta.urlOrFile ?? meta.sourceUrl,
    upload: meta.quota?.uploadBytes ?? meta.upload ?? 0,
    download: meta.quota?.downloadBytes ?? meta.download ?? 0,
    total: meta.quota?.totalBytes ?? meta.total ?? 0,
    expire: meta.quota?.expireUnix ?? meta.expire ?? 0,
    lastUpdated:
      meta.lastUpdated ??
      (Number.isFinite(timestamp) ? Math.max(0, timestamp) : 0),
  };
}

export interface LocalAPIStatusResponse {
  engine: LocalAPIEngineStatus;
  preferences: LocalAPIPreferences;
  threeTier: ThreeTierStatus;
  activeSub: SubscriptionMeta | null;
}

export interface LocalAPIConfig {
  endpoint: string;
  token: string;
}

/**
 * Detects LocalAPI connection info from HTML meta tags, query params, or localStorage.
 */
export function detectLocalAPIConfig(): LocalAPIConfig | null {
  if (typeof document === "undefined") return null;

  // 1. Injected by xbond daemon / web
  const metaToken = document
    .querySelector('meta[name="localapi-token"]')
    ?.getAttribute("content");
  const metaAddr = document
    .querySelector('meta[name="localapi-addr"]')
    ?.getAttribute("content");

  if (metaToken) {
    const endpoint = metaAddr ? metaAddr.replace(/\/$/, "") : "";
    return { endpoint, token: metaToken };
  }

  // 2. URL search params: ?localapi_token=...&localapi_addr=...
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const paramToken = searchParams.get("localapi_token");
    const paramAddr = searchParams.get("localapi_addr");
    if (paramToken) {
      return {
        endpoint: paramAddr ? paramAddr.replace(/\/$/, "") : "",
        token: paramToken,
      };
    }
  } catch {
    // Ignore URL parse errors
  }

  // 3. Saved in localStorage
  try {
    const savedToken = localStorage.getItem("xbond_localapi_token");
    const savedAddr = localStorage.getItem("xbond_localapi_addr");
    if (savedToken) {
      return {
        endpoint: savedAddr ? savedAddr.replace(/\/$/, "") : "",
        token: savedToken,
      };
    }
  } catch {
    // Ignore storage errors
  }

  return null;
}

/**
 * Checks whether the current frontend is running inside Tauri desktop shell.
 */
export function isDesktopApp(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "__TAURI_INTERNALS__" in window ||
    "__TAURI__" in window ||
    Boolean(
      (window as unknown as { __TAURI_METADATA__?: unknown })
        .__TAURI_METADATA__,
    )
  );
}

/**
 * Resolves LocalAPI configuration from Tauri desktop IPC if running in desktop mode.
 */
export async function resolveDesktopLocalAPIConfig(): Promise<LocalAPIConfig | null> {
  if (!isDesktopApp()) return null;
  try {
    const tauri = window as unknown as {
      __TAURI_INTERNALS__?: {
        invoke: (
          cmd: string,
        ) => Promise<{ addr: string; token: string; is_running: boolean }>;
      };
    };
    const invoke = tauri.__TAURI_INTERNALS__?.invoke;
    if (invoke) {
      const cfg = await invoke("get_localapi_config");
      if (cfg && cfg.token) {
        const endpoint = cfg.addr.startsWith("http")
          ? cfg.addr
          : `http://${cfg.addr}`;
        return { endpoint, token: cfg.token };
      }
    }
  } catch {
    // Ignore IPC resolution failure
  }
  return null;
}

export class LocalAPIClient {
  private endpoint: string;
  private token: string;

  constructor(endpoint: string, token: string) {
    this.endpoint = endpoint.replace(/\/$/, "");
    this.token = token;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.endpoint}${path}`;
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");
    if (this.token) {
      headers.set("X-XBond-Token", this.token);
    }

    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      let errMessage = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body.error) errMessage = body.error;
      } catch {
        // use status
      }
      throw new Error(errMessage);
    }

    return (await res.json()) as T;
  }

  async getStatus(): Promise<LocalAPIStatusResponse> {
    const data = await this.request<
      Omit<LocalAPIStatusResponse, "activeSub"> & {
        activeSub: SubscriptionWire | null;
      }
    >("/localapi/v0/status");
    return {
      ...data,
      activeSub: data.activeSub ? normalizeSubscription(data.activeSub) : null,
    };
  }

  async up(options?: {
    mode?: TakeoverMode;
    routing?: RoutingMode;
    port?: number;
    allowLan?: boolean;
    subId?: string;
  }): Promise<{ ok: boolean; status: LocalAPIEngineStatus }> {
    return this.request("/localapi/v0/up", {
      method: "POST",
      body: JSON.stringify(options ?? {}),
    });
  }

  async down(): Promise<{ ok: boolean }> {
    return this.request("/localapi/v0/down", {
      method: "POST",
    });
  }

  async restart(): Promise<{ ok: boolean; status: LocalAPIEngineStatus }> {
    return this.request("/localapi/v0/restart", {
      method: "POST",
    });
  }

  async setMode(options: {
    mode?: TakeoverMode;
    routing?: RoutingMode;
    port?: number;
    allowLan?: boolean;
  }): Promise<{ ok: boolean }> {
    return this.request("/localapi/v0/mode", {
      method: "POST",
      body: JSON.stringify(options),
    });
  }

  async selectNode(
    group: string,
    node: string,
  ): Promise<{ ok: boolean; group: string; node: string }> {
    return this.request("/localapi/v0/nodes/select", {
      method: "POST",
      body: JSON.stringify({ group, node }),
    });
  }

  async listSubs(): Promise<{
    subscriptions: SubscriptionMeta[];
    activeId: string;
  }> {
    const data = await this.request<{
      subscriptions: SubscriptionWire[];
      activeId: string;
    }>("/localapi/v0/subs");
    return {
      ...data,
      subscriptions: data.subscriptions.map(normalizeSubscription),
    };
  }

  async useSub(id: string): Promise<{ ok: boolean; activeId: string }> {
    return this.request("/localapi/v0/subs/use", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
  }

  async updateSub(
    id?: string,
  ): Promise<{ ok?: boolean; diff?: unknown; meta?: SubscriptionMeta }> {
    const data = await this.request<{
      ok?: boolean;
      diff?: unknown;
      meta?: SubscriptionWire;
    }>("/localapi/v0/subs/update", {
      method: "POST",
      body: JSON.stringify({ id: id ?? "" }),
    });
    return {
      ...data,
      meta: data.meta ? normalizeSubscription(data.meta) : undefined,
    };
  }

  async addSub(params: {
    token?: string;
    urlOrFile?: string;
    name?: string;
    protocol?: string;
    lang?: string;
    origin?: string;
  }): Promise<SubscriptionMeta> {
    const data = await this.request<SubscriptionWire>("/localapi/v0/login", {
      method: "POST",
      body: JSON.stringify(params),
    });
    return normalizeSubscription(data);
  }

  async removeSub(id: string): Promise<{ ok: boolean; deleted: string }> {
    return this.request(`/localapi/v0/subs?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async renameSub(id: string, name: string): Promise<{ ok: boolean }> {
    return this.request("/localapi/v0/subs", {
      method: "PATCH",
      body: JSON.stringify({ id, name }),
    });
  }

  async runDoctor(): Promise<unknown> {
    return this.request("/localapi/v0/doctor");
  }

  async getBugReport(): Promise<unknown> {
    return this.request("/localapi/v0/bugreport");
  }
}
