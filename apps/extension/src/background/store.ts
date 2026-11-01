// storage 包装：MV3 service worker 随时休眠，一切状态以 storage 为准，内存
// 只是缓存。凭据分层——代理凭据随配置（重启后必须可用，storage.local）；
// OAuth access token 属会话秘密（storage.session，浏览器退出即清）。

import { parseExtensionConfig } from "../shared/config.ts";
import type {
  DiagnosticEvent,
  ExtensionConfig,
  ExtensionPrefs,
} from "../shared/types.ts";

const CONFIG_KEY = "xbond.config";
const PREFS_KEY = "xbond.prefs";
const EVENTS_KEY = "xbond.events";

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
