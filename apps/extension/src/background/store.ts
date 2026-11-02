// storage 包装：MV3 service worker 随时休眠，一切状态以 storage 为准，内存
// 只是缓存。凭据分层——代理凭据随配置（重启后必须可用，storage.local）；
// OAuth access token 属会话秘密（storage.session，浏览器退出即清）。

import { parseExtensionConfig } from "../shared/config.ts";
import type {
  DiagnosticEvent,
  EntitlementInfo,
  ExtensionConfig,
  ExtensionPrefs,
} from "../shared/types.ts";

const CONFIG_KEY = "xbond.config";
const PREFS_KEY = "xbond.prefs";
const EVENTS_KEY = "xbond.events";
const ENTITLEMENT_KEY = "xbond.entitlement";
/** 会话秘密（storage.session，浏览器退出即清）：access token。 */
const ACCESS_KEY = "xbond.access";
/** 持久凭据（storage.local，威胁模型见 docs/specs/extension-host.md）：refresh token。 */
const REFRESH_KEY = "xbond.refresh";
/** 进行中的设备流登录（storage.session：浏览器重启即放弃登录）。 */
const PENDING_KEY = "xbond.pending-login";

/** 诊断事件环上限：管理页只看最近的运行轨迹。 */
const EVENT_RING_LIMIT = 200;

export const defaultPrefs: ExtensionPrefs = { enabled: false, mode: "global" };

function localGet(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (items) => resolve(items));
  });
}

function localSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}

/** 读取持久化配置；损坏的配置以 null 返回并交由调用方进入 invalid 状态。 */
export async function loadConfig(): Promise<ExtensionConfig | null> {
  const items = await localGet([CONFIG_KEY]);
  const raw = items[CONFIG_KEY];
  if (raw === undefined || raw === null) return null;
  try {
    return parseExtensionConfig(raw);
  } catch {
    return null;
  }
}

export async function saveConfig(config: ExtensionConfig): Promise<void> {
  await localSet({ [CONFIG_KEY]: config });
}

export async function clearConfig(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(CONFIG_KEY, () => resolve());
  });
}

export async function loadPrefs(): Promise<ExtensionPrefs> {
  const items = await localGet([PREFS_KEY]);
  const raw = items[PREFS_KEY];
  if (typeof raw !== "object" || raw === null) return { ...defaultPrefs };
  const record = raw as Partial<ExtensionPrefs>;
  return {
    enabled: record.enabled === true,
    mode: record.mode === "rules" ? "rules" : "global",
  };
}

export async function savePrefs(prefs: ExtensionPrefs): Promise<void> {
  await localSet({ [PREFS_KEY]: prefs });
}

/** 诊断事件追加（环）；失败静默——日志是辅助通道，不拖垮主流程。 */
export async function appendEvent(event: DiagnosticEvent): Promise<void> {
  try {
    const items = await localGet([EVENTS_KEY]);
    const ring = Array.isArray(items[EVENTS_KEY])
      ? (items[EVENTS_KEY] as DiagnosticEvent[])
      : [];
    ring.push(event);
    while (ring.length > EVENT_RING_LIMIT) ring.shift();
    await localSet({ [EVENTS_KEY]: ring });
  } catch {
    // 事件环满了或 storage 抖动：诊断记录让位于代理控制主流程。
  }
}

export async function loadEvents(): Promise<DiagnosticEvent[]> {
  const items = await localGet([EVENTS_KEY]);
  return Array.isArray(items[EVENTS_KEY])
    ? (items[EVENTS_KEY] as DiagnosticEvent[])
    : [];
}

export function logEvent(
  level: DiagnosticEvent["level"],
  message: string,
): void {
  void appendEvent({ at: Date.now(), level, message });
}

/** Token 对（access 在 session，refresh 在 local）。 */
export type StoredTokens = {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
};

export async function loadTokens(): Promise<StoredTokens | null> {
  const [session, local] = await Promise.all([
    sessionGet([ACCESS_KEY]),
    localGet([REFRESH_KEY]),
  ]);
  const access = session[ACCESS_KEY] as
    | { token?: unknown; expiresAt?: unknown }
    | undefined;
  const refresh = local[REFRESH_KEY];
  if (typeof access?.token !== "string" || typeof refresh !== "string") {
    return null;
  }
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
    localSet({ [REFRESH_KEY]: tokens.refreshToken }),
  ]);
}

/** 登出清凭据：access、refresh 与权益摘要一并清除（配置保留以便比对版本）。 */
export async function clearTokens(): Promise<void> {
  await Promise.all([
    sessionRemove([ACCESS_KEY]),
    localRemove([REFRESH_KEY, ENTITLEMENT_KEY]),
  ]);
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

function localRemove(keys: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, () => resolve());
  });
}

export async function saveEntitlement(info: EntitlementInfo): Promise<void> {
  await localSet({ [ENTITLEMENT_KEY]: info });
}

export async function loadEntitlement(): Promise<EntitlementInfo | null> {
  const items = await localGet([ENTITLEMENT_KEY]);
  const raw = items[ENTITLEMENT_KEY];
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Partial<EntitlementInfo>;
  if (
    typeof record.dataUsedBytes !== "number" ||
    typeof record.dataLimitBytes !== "number" ||
    typeof record.servicePeriodEnd !== "string"
  ) {
    return null;
  }
  return record as EntitlementInfo;
}

/** 设备流登录的进行态（会话作用域：浏览器重启即放弃登录）。 */
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
