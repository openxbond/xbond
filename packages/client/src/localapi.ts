/**
 * LocalAPI client for communication with xbond daemon.
 *
 * Provides typed access to local daemon status, engine up/down,
 * mode switches, and subscription management.
 */

import type { Lang } from "./language.ts";

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

export interface ThreeTierStatus {
  coreReachable: boolean;
  trafficIntercepted: boolean;
  interceptNote?: string;
  egressVerified: boolean;
  egressLatencyMs: number;
  takeoverMode: TakeoverMode;
  routingMode: RoutingMode;
  focusStrategy?: string;
  strategyChain?: string[];
}

/** Render languages accepted by /api/subscription/config. */
export type SubscriptionLang = "zh-HK" | "zh" | "en" | "ko" | "fa";

const SUBSCRIPTION_LANGS: Record<Lang, SubscriptionLang> = {
  en_US: "en",
  zh_CN: "zh",
  zh_HK: "zh-HK",
  ko: "ko",
  fa: "fa",
};

/** Subscription names are frozen per render language: map the UI locale once. */
export function subscriptionLang(lang: Lang): SubscriptionLang {
  return SUBSCRIPTION_LANGS[lang];
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

export interface AccountStatus {
  status: "signed_out" | "pending" | "signed_in" | "error";
  method?: "pkce" | "device";
  authUrl?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  userCode?: string;
  errorCode?: string;
  error?: string;
  startedAt?: string;
  subscription?: SubscriptionMeta | null;
  updateError?: string;
}

interface AccountStatusWire extends Omit<AccountStatus, "subscription"> {
  subscription?: SubscriptionWire | null;
}

function normalizeAccountStatus(wire: AccountStatusWire): AccountStatus {
  return {
    ...wire,
    subscription: wire.subscription
      ? normalizeSubscription(wire.subscription)
      : null,
  };
}

export interface LocalAPIConfig {
  endpoint: string;
  token: string;
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

  async accountStatus(): Promise<AccountStatus> {
    const data = await this.request<AccountStatusWire>("/localapi/v0/account");
    return normalizeAccountStatus(data);
  }

  async accountLogin(options?: {
    origin?: string;
    name?: string;
    lang?: string;
    protocol?: string;
    device?: boolean;
    noBrowser?: boolean;
  }): Promise<AccountStatus> {
    const data = await this.request<AccountStatusWire>(
      "/localapi/v0/account/login",
      {
        method: "POST",
        body: JSON.stringify(options ?? {}),
      },
    );
    return normalizeAccountStatus(data);
  }

  async accountLogout(): Promise<{
    ok: boolean;
    removed: SubscriptionMeta[];
  }> {
    const data = await this.request<{
      ok: boolean;
      removed: SubscriptionWire[];
    }>("/localapi/v0/account/logout", { method: "POST" });
    return { ...data, removed: data.removed.map(normalizeSubscription) };
  }

  async accountRefresh(): Promise<AccountStatus> {
    const data = await this.request<AccountStatusWire>(
      "/localapi/v0/account/refresh",
      { method: "POST" },
    );
    return normalizeAccountStatus(data);
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
