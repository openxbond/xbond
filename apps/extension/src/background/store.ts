// storage 包装：MV3 service worker 随时休眠，一切状态以 storage 为准。凭据
// 分层：access token 属会话秘密（storage.session，浏览器退出即清）；refresh
// token 持久化以支撑重启恢复；配置、选择、模式、用量落 storage.local。
// 威胁模型见 docs/specs/extension-host.md。

import {
  DEFAULT_PREFERENCES,
  REQUEST_RECORD_LIMIT,
  parseCommand,
  type LoginEnded,
  type Preferences,
  type RequestRecord,
  type RoutingMode,
  type Connectivity,
} from "../shared/control.ts";
import type { ExtensionConfig, Quota } from "../shared/extension-config.ts";
import type { WebsiteOverride } from "../shared/routing.ts";
import type { Selection } from "../shared/workspace.ts";

export type { RoutingMode };

const ACCESS_KEY = "xbond.access";
const REFRESH_KEY = "xbond.refresh";
const PENDING_KEY = "xbond.pending-login";
export const CONFIG_KEY = "xbond.config";
export const SELECTION_KEY = "xbond.selection";
export const MODE_KEY = "xbond.mode";
export const ENABLED_KEY = "xbond.enabled";
const QUOTA_KEY = "xbond.quota";
const EVENTS_KEY = "xbond.events";
export const GLOBAL_EXIT_KEY = "xbond.global-exit";
const PREFERENCES_KEY = "xbond.preferences";
export const OVERRIDES_KEY = "xbond.overrides";
const RECORDING_KEY = "xbond.recording";
const REQUESTS_KEY = "xbond.requests";
const CONNECTIVITY_KEY = "xbond.connectivity";
const BOUND_KEY = "xbond.config.bound";
const META_KEY = "xbond.config.meta";
const LOGIN_ENDED_KEY = "xbond.login-ended";

const EVENT_RING_LIMIT = 200;

function get(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) =>
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(items),
    );
  });
}

function set(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () =>
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(),
    );
  });
}

function remove(keys: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () =>
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(),
    );
  });
}

function sessionGet(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.get(keys, (items) =>
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(items),
    );
  });
}

function sessionSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.set(items, () =>
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(),
    );
  });
}

function sessionRemove(keys: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.remove(keys, () =>
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(),
    );
  });
}

export type StoredTokens = {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
};

export async function loadTokens(): Promise<StoredTokens | null> {
  const [session, local] = await Promise.all([
    sessionGet([ACCESS_KEY]),
    get([REFRESH_KEY]),
  ]);
  const access = session[ACCESS_KEY] as
    | { token?: unknown; expiresAt?: unknown }
    | undefined;
  const refresh = local[REFRESH_KEY];
  if (typeof refresh !== "string") return null;
  return {
    accessToken: typeof access?.token === "string" ? access.token : "",
    accessTokenExpiresAt:
      typeof access?.expiresAt === "number" ? access.expiresAt : 0,
    refreshToken: refresh,
  };
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await Promise.all([
    sessionSet({
      [ACCESS_KEY]: {
        token: tokens.accessToken,
        expiresAt: tokens.accessTokenExpiresAt,
      },
    }),
    set({ [REFRESH_KEY]: tokens.refreshToken }),
  ]);
}

/** 登出清凭据：access、refresh、权益摘要与待处理登录一并清除（配置保留，
 * 重新登录后比对版本）。 */
export async function clearTokens(): Promise<void> {
  await Promise.all([
    sessionRemove([ACCESS_KEY, PENDING_KEY]),
    remove([REFRESH_KEY, QUOTA_KEY]),
  ]);
  await set({ [BOUND_KEY]: false });
}

export type PendingLogin = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresAt: number;
  intervalSeconds: number;
};

export async function loadPendingLogin(): Promise<PendingLogin | null> {
  const items = await sessionGet([PENDING_KEY]);
  const raw = items[PENDING_KEY];
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Partial<PendingLogin>;
  if (
    typeof record.deviceCode !== "string" ||
    typeof record.userCode !== "string" ||
    typeof record.verificationUri !== "string"
  ) {
    return null;
  }
  return {
    deviceCode: record.deviceCode,
    userCode: record.userCode,
    verificationUri: record.verificationUri,
    verificationUriComplete:
      typeof record.verificationUriComplete === "string"
        ? record.verificationUriComplete
        : null,
    expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : 0,
    intervalSeconds:
      typeof record.intervalSeconds === "number" ? record.intervalSeconds : 5,
  };
}

export async function savePendingLogin(pending: PendingLogin): Promise<void> {
  await sessionSet({ [PENDING_KEY]: pending });
}

export async function clearPendingLogin(): Promise<void> {
  await sessionRemove([PENDING_KEY]);
}

export async function loadConfig(): Promise<ExtensionConfig | null> {
  const items = await get([CONFIG_KEY]);
  return (items[CONFIG_KEY] as ExtensionConfig | undefined) ?? null;
}

export async function saveConfig(config: ExtensionConfig): Promise<void> {
  await set({
    [CONFIG_KEY]: config,
    [BOUND_KEY]: true,
    [META_KEY]: { updatedAt: Date.now(), error: null },
  });
  await saveConnectivity({ status: "unknown", target: "" });
}

export async function loadSelection(): Promise<Selection> {
  const items = await get([SELECTION_KEY]);
  const raw = items[SELECTION_KEY];
  if (typeof raw !== "object" || raw === null) return {};
  const selection: Selection = {};
  for (const [group, member] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (typeof member === "string") selection[group] = member;
  }
  return selection;
}

export async function saveSelection(selection: Selection): Promise<void> {
  await set({ [SELECTION_KEY]: selection });
}

export async function loadMode(): Promise<RoutingMode> {
  const items = await get([MODE_KEY]);
  return items[MODE_KEY] === "global" || items[MODE_KEY] === "direct"
    ? (items[MODE_KEY] as RoutingMode)
    : "rule";
}

export async function saveMode(mode: RoutingMode): Promise<void> {
  await set({ [MODE_KEY]: mode });
}

export async function loadEnabled(): Promise<boolean> {
  const items = await get([ENABLED_KEY]);
  return items[ENABLED_KEY] === true;
}

export async function saveEnabled(enabled: boolean): Promise<void> {
  await set({ [ENABLED_KEY]: enabled });
}
export async function loadGlobalExit(): Promise<string> {
  const value = (await get([GLOBAL_EXIT_KEY]))[GLOBAL_EXIT_KEY];
  return typeof value === "string" ? value : "";
}
export async function saveGlobalExit(value: string): Promise<void> {
  await set({ [GLOBAL_EXIT_KEY]: value });
}

export async function loadQuota(): Promise<Quota | null> {
  const items = await get([QUOTA_KEY]);
  return (items[QUOTA_KEY] as Quota | undefined) ?? null;
}

export async function saveQuota(quota: Quota | null): Promise<void> {
  await set({ [QUOTA_KEY]: quota });
}

export type DiagnosticEvent = {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
};

export async function appendEvent(
  level: DiagnosticEvent["level"],
  message: string,
): Promise<void> {
  try {
    const items = await get([EVENTS_KEY]);
    const ring = Array.isArray(items[EVENTS_KEY])
      ? (items[EVENTS_KEY] as DiagnosticEvent[])
      : [];
    ring.push({ at: Date.now(), level, message });
    while (ring.length > EVENT_RING_LIMIT) ring.shift();
    await set({ [EVENTS_KEY]: ring });
  } catch {
    // 诊断记录让位于代理控制主流程。
  }
}

export function logEvent(
  level: DiagnosticEvent["level"],
  message: string,
): void {
  eventQueue = eventQueue.then(() => appendEvent(level, redact(message)));
}

export async function loadEvents(): Promise<DiagnosticEvent[]> {
  await eventQueue;
  const items = await get([EVENTS_KEY]);
  return Array.isArray(items[EVENTS_KEY])
    ? (items[EVENTS_KEY] as DiagnosticEvent[])
    : [];
}

let eventQueue: Promise<void> = Promise.resolve();
export function redact(message: string): string {
  return message
    .replace(/px-[a-f0-9]{48}/gi, "[proxy token]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[credential]")
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .slice(0, 600);
}
export async function configBound(): Promise<boolean> {
  return (await get([BOUND_KEY]))[BOUND_KEY] === true;
}
export async function loadConfigMeta(): Promise<{
  updatedAt: number | null;
  error: string | null;
}> {
  const value = (await get([META_KEY]))[META_KEY];
  if (!value || typeof value !== "object")
    return { updatedAt: null, error: null };
  const meta = value as Record<string, unknown>;
  return {
    updatedAt: typeof meta.updatedAt === "number" ? meta.updatedAt : null,
    error: typeof meta.error === "string" ? redact(meta.error) : null,
  };
}
export async function saveConfigError(error: string): Promise<void> {
  await set({
    [META_KEY]: { ...(await loadConfigMeta()), error: redact(error) },
  });
}
export async function loadPreferences(): Promise<Preferences> {
  const value = (await get([PREFERENCES_KEY]))[PREFERENCES_KEY];
  const parsed = parseCommand({ type: "set-preferences", preferences: value });
  return parsed?.type === "set-preferences"
    ? parsed.preferences
    : { ...DEFAULT_PREFERENCES };
}
export async function savePreferences(value: Preferences): Promise<void> {
  await set({ [PREFERENCES_KEY]: value });
}
export async function loadOverrides(): Promise<WebsiteOverride[]> {
  const value = (await get([OVERRIDES_KEY]))[OVERRIDES_KEY];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = parseCommand({ type: "save-override", override: item });
    return parsed?.type === "save-override" ? [parsed.override] : [];
  });
}
export async function saveOverrides(value: WebsiteOverride[]): Promise<void> {
  await set({ [OVERRIDES_KEY]: value });
}
export async function clearEvents(): Promise<void> {
  await eventQueue;
  await set({ [EVENTS_KEY]: [] });
}
export async function loadRecording(): Promise<boolean> {
  return (await sessionGet([RECORDING_KEY]))[RECORDING_KEY] === true;
}
export async function saveRecording(enabled: boolean): Promise<void> {
  await sessionSet({ [RECORDING_KEY]: enabled });
}
const REQUEST_STATUSES = ["pending", "completed", "failed", "interrupted"];
export async function loadRequests(): Promise<RequestRecord[]> {
  const value = (await sessionGet([REQUESTS_KEY]))[REQUESTS_KEY];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const r = item as Record<string, unknown>;
    if (
      typeof r.id !== "string" ||
      typeof r.host !== "string" ||
      typeof r.at !== "number" ||
      !REQUEST_STATUSES.includes(r.status as string)
    )
      return [];
    return [
      {
        id: r.id,
        at: r.at,
        host: r.host,
        type: typeof r.type === "string" ? r.type : "other",
        status: r.status as RequestRecord["status"],
        ...(typeof r.duration === "number" ? { duration: r.duration } : {}),
        ...(typeof r.error === "string" ? { error: r.error } : {}),
      },
    ];
  });
}
export async function saveRequests(records: RequestRecord[]): Promise<void> {
  await sessionSet({ [REQUESTS_KEY]: records.slice(-REQUEST_RECORD_LIMIT) });
}
export async function loadConnectivity(): Promise<Connectivity> {
  const value = (await sessionGet([CONNECTIVITY_KEY]))[CONNECTIVITY_KEY];
  return value && typeof value === "object"
    ? (value as Connectivity)
    : { status: "unknown", target: "" };
}
export async function saveConnectivity(value: Connectivity): Promise<void> {
  await sessionSet({ [CONNECTIVITY_KEY]: value });
}

/** 登录结局：仅记录非成功的收场（过期/未确认），重新发起登录即清除。 */
export async function loadLoginEnded(): Promise<LoginEnded | null> {
  const value = (await sessionGet([LOGIN_ENDED_KEY]))[LOGIN_ENDED_KEY];
  return value === "expired" || value === "failed" ? value : null;
}
export async function saveLoginEnded(value: LoginEnded): Promise<void> {
  await sessionSet({ [LOGIN_ENDED_KEY]: value });
}
export async function clearLoginEnded(): Promise<void> {
  await sessionRemove([LOGIN_ENDED_KEY]);
}
