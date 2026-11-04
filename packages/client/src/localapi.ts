/**
 * LocalAPI client for communication with xbond daemon.
 *
 * Provides typed access to local daemon status, engine up/down,
 * mode switches, and subscription management.
 */

import type { Lang } from "./language.ts";
import type { Rule } from "./request.ts";

export interface LocalAPIEngineStatus {
  running: boolean;
  pid: number;
  mixedPort: number;
  clashPort: number;
  uptime: string;
  configPath: string;
  startedAt?: string;
}

export type TakeoverMode = "sysproxy" | "tun" | "port";
export type RoutingMode = "rule" | "global" | "direct";

/** Where the effective mixed port came from: a fixed local override, the
 * subscription's own port, or the daemon default. */
export type PortSource = "override" | "subscription" | "default";

export interface LocalAPIPreferences {
  systemProxy: boolean;
  tun: boolean;
  takeoverMode?: TakeoverMode;
  routingMode: RoutingMode;
  mixedPort: number;
  allowLan: boolean;
  clashPort: number;
  clashSecret?: string;
  /** 0 = follow the subscription's own port. */
  portOverride: number;
  portSource?: PortSource;
}

export interface ThreeTierStatus {
  coreReachable: boolean;
  trafficIntercepted: boolean;
  interceptNote?: string;
  systemProxyActive?: boolean;
  tunActive?: boolean;
  egressVerified: boolean;
  egressLatencyMs: number;
  takeoverMode?: TakeoverMode;
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

export type ProfileKind = "remote" | "local" | "inline" | "cloud";

export interface GlobalMixin {
  bypassLan?: boolean;
  rulesPrepend?: string[];
  rulesAppend?: string[];
  dns?: string;
}

export interface SubscriptionMeta {
  id: string;
  name: string;
  type: "xbond" | "universal";
  kind?: ProfileKind;
  accountIssuer?: string;
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
  /** Daemon fetch health: "ok" | "transient_error" | "credential_invalid" | … */
  health?: string;
  lastErrorMessage?: string;
  /** Which core owns this subscription: "clash" (mihomo) or "sing-box". */
  format?: "clash" | "sing-box";
  /** Update channel: "direct" (or empty), "self" (the daemon's own proxy
   * while the core runs) or "proxy" (a saved URL). */
  updateChannel?: "direct" | "self" | "proxy" | "";
  updateProxy?: string;
  /** An edited source copy: automatic updates skip it; a manual update
   * removes the pin. */
  sourcePinned?: boolean;
}

/** An account-bound source takes precedence over manually imported Cloud links. */
export function cloudSubscription(
  subscriptions: readonly SubscriptionMeta[],
  accountSource?: SubscriptionMeta | null,
): SubscriptionMeta | undefined {
  return (
    subscriptions.find(
      (item) => item.type === "xbond" && item.id === accountSource?.id,
    ) ??
    (accountSource?.type === "xbond" ? accountSource : undefined) ??
    subscriptions.find((item) => item.type === "xbond" && item.accountIssuer) ??
    subscriptions.find((item) => item.type === "xbond")
  );
}

/**
 * 配額狀態的三種事實：未知（沒有資料或數值不可用）、未設定總額
 * （total <= 0）與可用。介面必須分開呈現，不能合併成一句「未有配額資料」。
 */
export function subscriptionQuotaStatus(
  meta: Pick<SubscriptionMeta, "upload" | "download" | "total"> | null,
): "unknown" | "noTotal" | "ready" {
  if (!meta) return "unknown";
  if (
    ![meta.upload, meta.download, meta.total].every(Number.isFinite) ||
    meta.upload < 0 ||
    meta.download < 0
  )
    return "unknown";
  if (meta.total <= 0) return "noTotal";
  return "ready";
}

export function subscriptionQuota(
  meta: Pick<SubscriptionMeta, "upload" | "download" | "total"> | null,
) {
  if (!meta || subscriptionQuotaStatus(meta) !== "ready") return null;
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
  contentHash?: string;
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
    lastHash: meta.lastHash ?? meta.contentHash,
    upload: meta.quota?.uploadBytes ?? meta.upload ?? 0,
    download: meta.quota?.downloadBytes ?? meta.download ?? 0,
    total: meta.quota?.totalBytes ?? meta.total ?? 0,
    expire: meta.quota?.expireUnix ?? meta.expire ?? 0,
    lastUpdated:
      meta.lastUpdated ??
      (Number.isFinite(timestamp) ? Math.max(0, timestamp) : 0),
  };
}

/** Daemon-side privilege facts the UI must not guess: TUN takeover needs an
 * elevated token (Windows) or root (unix) — this process's own, or the
 * privileged system service's via delegation — plus, on Windows, the wintun
 * driver DLL. Absent on non-daemon controllers. */
export interface LocalAPICapabilities {
  tun: boolean;
  tunReasonCode?:
    | "not_elevated"
    | "not_root"
    | "wintun_missing"
    | "service_unreachable";
  tunReason?: string;
  serviceInstalled?: boolean;
  /** True when the takeover runs in the privileged system service, not this process. */
  delegated?: boolean;
}

export interface LocalAPIStatusResponse {
  engine: LocalAPIEngineStatus;
  preferences: LocalAPIPreferences;
  threeTier: ThreeTierStatus;
  activeSub: SubscriptionMeta | null;
  capabilities?: LocalAPICapabilities;
  rulePaging?: boolean;
}

/** Service status from user.billing.subscription (billing-disabled collapses
 * to plan "free" with enabled false). */
export interface AccountServiceStatus {
  enabled: boolean;
  plan: string;
  status?: string;
  planSlug?: string;
  servicePeriodEnd?: string;
  quotaState?: string;
  dataLimitBytes?: number | null;
  dataUsedBytes?: number | null;
  cancelAtPeriodEnd: boolean;
}

export interface AccountAnnouncement {
  id: string;
  title: string;
  summary?: string;
  category?: string;
  publishedAt?: string;
  readAt?: string | null;
}

export interface AccountStatus {
  status: "signed_out" | "pending" | "signed_in" | "error";
  phase?:
    | "authorizing"
    | "exchanging_token"
    | "fetching_subscription"
    | "syncing_subscription"
    | "loading_account";
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
  /** Identity, service status and announcements from the last overview sync
   * (cached across daemon restarts; absent until the first sync). */
  email?: string;
  name?: string;
  /** Trusted console entry: the session's own origin + /dash. */
  consoleUrl?: string;
  service?: AccountServiceStatus | null;
  announcements?: AccountAnnouncement[];
  unreadCount?: number;
  overviewError?: string;
}

/** Structured local override: the layer between the downloaded source and
 * derivation. The source bytes are never rewritten. `dns` is the raw
 * override text, parsed with the core native to the subscription format. */
export interface SubscriptionOverride {
  rulesPrepend?: string[];
  rulesAppend?: string[];
  dns?: string;
}

export interface SubscriptionFetchProgress {
  active: boolean;
  subId?: string;
  name?: string;
  bytes: number;
  /** 0 = size unknown (chunked response). */
  total: number;
  startedAt?: string;
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

export interface RulePage {
  rules: (Rule & { index: number })[];
  total: number;
}

interface LocalAPILogEntry {
  seq: number;
  timestamp: string;
  level: string;
  message: string;
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

  async getLogs(level: string, limit: number): Promise<LocalAPILogEntry[]> {
    const query = new URLSearchParams({ level, limit: String(limit) });
    const { logs } = await this.request<{ logs: LocalAPILogEntry[] }>(
      `/localapi/v0/logs?${query}`,
    );
    return logs;
  }

  async getRulesPage(params: URLSearchParams): Promise<RulePage> {
    return this.request(`/localapi/v0/rules/page?${params}`);
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
    systemProxy?: boolean;
    tun?: boolean;
    mode?: TakeoverMode;
    routing?: RoutingMode;
    port?: number;
    allowLan?: boolean;
  }): Promise<{ ok: boolean; preferences?: LocalAPIPreferences }> {
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

  /** Persists the subscription's update channel. "proxy" requires an
   * absolute http(s) or socks5 URL; other channels clear it. */
  async setSubChannel(
    id: string,
    channel: "direct" | "self" | "proxy",
    proxyURL = "",
  ): Promise<{ ok: boolean }> {
    return this.request("/localapi/v0/subs", {
      method: "PATCH",
      body: JSON.stringify({
        id,
        updateChannel: channel,
        updateProxy: proxyURL,
      }),
    });
  }

  async rollbackSub(
    id: string,
  ): Promise<{ ok: boolean; meta?: SubscriptionMeta }> {
    const data = await this.request<{
      ok: boolean;
      meta?: SubscriptionWire;
    }>("/localapi/v0/subs/rollback", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
    return {
      ...data,
      meta: data.meta ? normalizeSubscription(data.meta) : undefined,
    };
  }

  /** Reads the subscription's current source for the raw editor. */
  async getSubSource(id: string): Promise<string> {
    const data = await this.request<{ content: string }>(
      `/localapi/v0/subs/source?id=${encodeURIComponent(id)}`,
    );
    return data.content;
  }

  /** Replaces the source with user content (detection + core + override
   * gates) and pins it against automatic updates. */
  async editSubSource(
    id: string,
    content: string,
  ): Promise<{ ok: boolean; meta?: SubscriptionMeta }> {
    const data = await this.request<{
      ok: boolean;
      meta?: SubscriptionWire;
    }>("/localapi/v0/subs/source", {
      method: "PUT",
      body: JSON.stringify({ id, content }),
    });
    return {
      ...data,
      meta: data.meta ? normalizeSubscription(data.meta) : undefined,
    };
  }

  /** Changes a universal subscription's source URL without replacing it. */
  async changeSubURL(id: string, url: string): Promise<{ ok: boolean }> {
    return this.request("/localapi/v0/subs/url", {
      method: "PUT",
      body: JSON.stringify({ id, url }),
    });
  }

  /** Removes the pin an edited source carries, resuming auto-updates. */
  async unpinSub(id: string): Promise<{ ok: boolean }> {
    return this.request("/localapi/v0/subs/unpin", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
  }

  async createProfile(params: {
    kind?: ProfileKind;
    name?: string;
    url?: string;
    content?: string;
    intervalHours?: number;
    use?: boolean;
  }): Promise<{
    ok: boolean;
    profile: SubscriptionMeta | null;
    updateError?: string;
  }> {
    const data = await this.request<{
      ok?: boolean;
      profile?: SubscriptionWire;
      meta?: SubscriptionWire;
      updateError?: string;
    }>("/localapi/v0/profiles", {
      method: "POST",
      body: JSON.stringify(params),
    });
    const wire = data.profile ?? data.meta;
    return {
      ok: data.ok ?? Boolean(wire),
      profile: wire ? normalizeSubscription(wire) : null,
      updateError: data.updateError,
    };
  }

  async addSub(params: {
    kind?: ProfileKind;
    token?: string;
    urlOrFile?: string;
    content?: string;
    updateIntervalHours?: number;
    name?: string;
    protocol?: string;
    lang?: string;
    origin?: string;
  }): Promise<{
    ok: boolean;
    meta: SubscriptionMeta | null;
    updateError?: string;
  }> {
    // The daemon's /login handler answers { ok, meta, updateError }: the
    // subscription is saved even when the first config fetch failed.
    const data = await this.request<{
      ok?: boolean;
      meta?: SubscriptionWire;
      updateError?: string;
    }>("/localapi/v0/login", {
      method: "POST",
      body: JSON.stringify({ ...params, use: false }),
    });
    return {
      ok: data.ok ?? false,
      meta: data.meta ? normalizeSubscription(data.meta) : null,
      updateError: data.updateError,
    };
  }

  async subscriptionProgress(): Promise<SubscriptionFetchProgress> {
    return this.request("/localapi/v0/subs/progress");
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

  /** Re-resolves the subscription link. `lang` (render language) follows the
   * UI language so the fetched configuration names match the interface;
   * omitting it keeps the subscription's persisted language. */
  async accountRefresh(options?: { lang?: string }): Promise<AccountStatus> {
    const data = await this.request<AccountStatusWire>(
      "/localapi/v0/account/refresh",
      { method: "POST", body: JSON.stringify(options ?? {}) },
    );
    return normalizeAccountStatus(data);
  }

  /** Aborts an in-flight login; required before restarting with a different
   * method (the daemon refuses a new flow while one is pending). */
  async accountCancel(): Promise<AccountStatus> {
    const data = await this.request<AccountStatusWire>(
      "/localapi/v0/account/cancel",
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

  async setSubUpdateSchedule(
    id: string,
    updateIntervalHours: number,
  ): Promise<{ ok: boolean }> {
    return this.request("/localapi/v0/subs", {
      method: "PATCH",
      body: JSON.stringify({ id, updateIntervalHours }),
    });
  }

  /** Structured local override spliced onto the source before derivation. */
  async getSubOverride(id: string): Promise<SubscriptionOverride> {
    return this.request(
      `/localapi/v0/subs/override?id=${encodeURIComponent(id)}`,
    );
  }

  async setSubOverride(
    id: string,
    override: SubscriptionOverride,
  ): Promise<{ ok: boolean }> {
    return this.request("/localapi/v0/subs/override", {
      method: "PUT",
      body: JSON.stringify({ id, ...override }),
    });
  }

  async getGlobalMixin(): Promise<GlobalMixin> {
    return this.request("/localapi/v0/mixins/global");
  }

  async setGlobalMixin(
    mixin: GlobalMixin,
  ): Promise<{ ok: boolean; mixin?: GlobalMixin }> {
    return this.request("/localapi/v0/mixins/global", {
      method: "PUT",
      body: JSON.stringify(mixin),
    });
  }

  async runDoctor(): Promise<unknown> {
    return this.request("/localapi/v0/doctor");
  }

  async getBugReport(): Promise<unknown> {
    return this.request("/localapi/v0/bugreport");
  }

  async installService(): Promise<{ ok: boolean; message?: string }> {
    return this.request("/localapi/v0/service/install", {
      method: "POST",
    });
  }

  async uninstallService(): Promise<{ ok: boolean; message?: string }> {
    return this.request("/localapi/v0/service/uninstall", {
      method: "POST",
    });
  }
}
