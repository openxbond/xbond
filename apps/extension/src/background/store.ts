// storage 包装：MV3 service worker 随时休眠，一切状态以 storage 为准。凭据
// 分层：access token 属会话秘密（storage.session，浏览器退出即清）；refresh
// token 持久化以支撑重启恢复；配置、选择、模式、用量落 storage.local。
// 威胁模型见 docs/specs/extension-host.md。

import type { ExtensionConfig, Quota } from "../shared/extension-config.ts";
import type { Selection } from "../shared/workspace.ts";

export type RoutingMode = "rule" | "global" | "direct";

const ACCESS_KEY = "xbond.access";
const REFRESH_KEY = "xbond.refresh";
const PENDING_KEY = "xbond.pending-login";
const CONFIG_KEY = "xbond.config";
const SELECTION_KEY = "xbond.selection";
const MODE_KEY = "xbond.mode";
const ENABLED_KEY = "xbond.enabled";
const QUOTA_KEY = "xbond.quota";
const EVENTS_KEY = "xbond.events";

const EVENT_RING_LIMIT = 200;

function get(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (items) => resolve(items));
  });
}

function set(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}

function remove(keys: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, () => resolve());
  });
}

function sessionGet(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    chrome.storage.session.get(keys, (items) => resolve(items));
  });
}

function sessionSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.session.set(items, () => resolve());
  });
}

function sessionRemove(keys: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.session.remove(keys, () => resolve());
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
  if (typeof access?.token !== "string" || typeof refresh !== "string")
    return null;
  return {
    accessToken: access.token,
    accessTokenExpiresAt:
      typeof access.expiresAt === "number" ? access.expiresAt : 0,
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
  await set({ [CONFIG_KEY]: config });
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

export async function loadQuota(): Promise<Quota | null> {
  const items = await get([QUOTA_KEY]);
  return (items[QUOTA_KEY] as Quota | undefined) ?? null;
}

export async function saveQuota(quota: Quota): Promise<void> {
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
  void appendEvent(level, message);
}

export async function loadEvents(): Promise<DiagnosticEvent[]> {
  const items = await get([EVENTS_KEY]);
  return Array.isArray(items[EVENTS_KEY])
    ? (items[EVENTS_KEY] as DiagnosticEvent[])
    : [];
}
