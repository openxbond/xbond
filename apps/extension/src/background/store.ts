// storage 包装：MV3 service worker 随时休眠，一切状态以 storage 为准。订阅
// 链接本身就是凭据（状态页给出的 sub- 令牌链接），配置、选择与模式全部落
// storage.local；威胁模型见 docs/specs/extension-host.md。

import type { Quota } from "../shared/extension-config.ts";
import type { ExtensionConfig } from "../shared/extension-config.ts";
import type { Selection } from "../shared/workspace.ts";

export type RoutingMode = "rule" | "global" | "direct";

const SUBSCRIPTION_KEY = "xbond.subscription";
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

export type SubscriptionSource = {
  /** 订阅配置地址（状态页签发；恒带 target=extension）。 */
  url: string;
  importedAt: number;
  /** 签发版本（HTTP ETag 或本地时间戳），仅用于诊断展示。 */
  version: string;
};

export async function loadSubscription(): Promise<SubscriptionSource | null> {
  const items = await get([SUBSCRIPTION_KEY]);
  const raw = items[SUBSCRIPTION_KEY] as
    | Partial<SubscriptionSource>
    | undefined;
  if (typeof raw?.url !== "string" || raw.url === "") return null;
  return {
    url: raw.url,
    importedAt: typeof raw.importedAt === "number" ? raw.importedAt : 0,
    version: typeof raw.version === "string" ? raw.version : "",
  };
}

export async function saveSubscription(
  source: SubscriptionSource,
): Promise<void> {
  await set({ [SUBSCRIPTION_KEY]: source });
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
