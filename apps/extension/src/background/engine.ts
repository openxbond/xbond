// 引擎编排：状态机 + 恢复循环。MV3 SW 随时休眠，一切决策从 storage 出发
// （reconcile），安装/启动/alarm/存储变化都是触发器；每次核对 chrome.proxy
// 的实际设置与 levelOfControl：能自愈就重放期望值，被策略或他人持有则显式
// control-lost（不夺权）。入口不可达不静默 DIRECT 兜底。

import type { ExtensionConfig, Quota } from "../shared/extension-config.ts";
import type { Selection } from "../shared/workspace.ts";
import { createAuthGate, createAuthHandler, resetAuthGate } from "./auth.ts";
import {
  clearProxy,
  expectedProxyValue,
  readProxySetting,
  setProxy,
  settingMatches,
} from "./proxy.ts";
import {
  loadConfig,
  loadEnabled,
  loadEvents,
  loadMode,
  loadQuota,
  loadSelection,
  loadSubscription,
  logEvent,
  saveEnabled,
  saveMode,
  saveSelection,
  type DiagnosticEvent,
  type RoutingMode,
} from "./store.ts";
import { refreshSubscription } from "./subscription.ts";

const UNREACHABLE_WINDOW_MS = 60_000;
const UNREACHABLE_THRESHOLD = 5;

export type ProxyState =
  | { kind: "off" }
  | {
      kind: "ok";
      mode: RoutingMode;
      nodeCount: number;
      selection: Selection;
      quota: Quota | null;
    }
  | { kind: "no-subscription" }
  | { kind: "auth-failed"; detail: string }
  | { kind: "unreachable"; detail: string }
  | { kind: "control-lost"; holder: string }
  | { kind: "invalid-config"; detail: string }
  | { kind: "error"; detail: string };

export type ExtensionMessage =
  | { type: "get-state" }
  | { type: "get-events" }
  | { type: "set-enabled"; enabled: boolean }
  | { type: "set-mode"; mode: RoutingMode }
  | { type: "set-selection"; group: string; member: string }
  | { type: "import-subscription"; url: string }
  | { type: "refresh-subscription" };

export type StateMessage = { type: "state"; state: ProxyState };

let state: ProxyState = { kind: "off" };

const authGate = createAuthGate();
const proxyErrors: number[] = [];

export function currentState(): ProxyState {
  return state;
}

function setState(next: ProxyState): void {
  const changed = JSON.stringify(next) !== JSON.stringify(state);
  state = next;
  if (changed) broadcastState(next);
}

function broadcastState(next: ProxyState): void {
  const message: StateMessage = { type: "state", state: next };
  try {
    chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
  } catch {
    // 无接收方（popup/管理页都关着）时 sendMessage 抛错：正常，忽略。
  }
}

/** 入口层错误采样（onErrorOccurred）；超阈值置 unreachable。 */
export function recordProxyError(error: string): void {
  const now = Date.now();
  while (proxyErrors.length > 0 && now - proxyErrors[0] > UNREACHABLE_WINDOW_MS)
    proxyErrors.shift();
  proxyErrors.push(now);
  if (proxyErrors.length >= UNREACHABLE_THRESHOLD && state.kind === "ok") {
    setState({ kind: "unreachable", detail: error });
    logEvent("warn", `ingress unreachable: ${error}`);
  }
}

function okState(
  config: ExtensionConfig,
  mode: RoutingMode,
  selection: Selection,
  quota: Quota | null,
): ProxyState {
  return { kind: "ok", mode, nodeCount: config.nodes.length, selection, quota };
}

/** 中心收敛：读偏好与配置，核对实际代理设置，自愈或上报。 */
export async function reconcile(reason: string): Promise<ProxyState> {
  const enabled = await loadEnabled();
  const config = await loadConfig();

  if (!enabled) {
    await releaseIfControlled("disabled");
    resetAuthGate(authGate);
    setState({ kind: "off" });
    return state;
  }
  if (!config) {
    await releaseIfControlled("no-subscription");
    setState({ kind: "no-subscription" });
    return state;
  }

  const mode = await loadMode();
  const selection = await loadSelection();
  const source = await loadSubscription();
  const expected = expectedProxyValue(
    config,
    selection,
    mode,
    source?.url ?? null,
  );
  let setting: Awaited<ReturnType<typeof readProxySetting>>;
  try {
    setting = await readProxySetting();
  } catch (error) {
    setState({
      kind: "error",
      detail: `proxy settings unreadable: ${String(error)}`,
    });
    return state;
  }
  if (setting === null) {
    setState({ kind: "error", detail: "proxy settings unavailable" });
    return state;
  }
  if (setting.levelOfControl === "not_controllable") {
    setState({ kind: "control-lost", holder: "enterprise policy" });
    logEvent("warn", "proxy control is held by enterprise policy");
    return state;
  }
  if (setting.levelOfControl === "controlled_by_other_extensions") {
    setState({ kind: "control-lost", holder: "another extension" });
    logEvent("warn", "proxy control is held by another extension");
    return state;
  }

  try {
    if (expected === null) {
      if (setting.levelOfControl === "controlled_by_this_extension") {
        await clearProxy();
        logEvent("info", "direct mode: proxy released");
      }
    } else if (!settingMatches(setting, expected)) {
      await setProxy(expected);
      logEvent(
        "info",
        `proxy applied (${mode}) on ${config.nodes.length} nodes — ${reason}`,
      );
    }
  } catch (error) {
    setState({ kind: "error", detail: `proxy apply failed: ${String(error)}` });
    logEvent("error", `proxy apply failed: ${String(error)}`);
    return state;
  }

  setState(okState(config, mode, selection, await loadQuota()));
  return state;
}

/** 仅当设置仍归本扩展时释放（clear）；他人持有或被策略接管时不动它。 */
async function releaseIfControlled(reason: string): Promise<void> {
  try {
    const setting = await readProxySetting();
    if (
      setting &&
      setting.levelOfControl !== "not_controllable" &&
      setting.levelOfControl !== "controlled_by_other_extensions"
    ) {
      await clearProxy();
      logEvent("info", `proxy released (${reason})`);
    }
  } catch (error) {
    logEvent("warn", `proxy release failed: ${String(error)}`);
  }
}

/** 消息入口：popup / 管理页 / content script 的唯一控制面。 */
export async function handleMessage(
  message: ExtensionMessage,
): Promise<ProxyState | { events: DiagnosticEvent[] }> {
  switch (message.type) {
    case "get-state":
      return state;
    case "get-events":
      return { events: await loadEvents() };
    case "set-enabled": {
      await saveEnabled(message.enabled);
      return reconcile(message.enabled ? "enabled" : "disabled");
    }
    case "set-mode": {
      await saveMode(message.mode);
      resetAuthGate(authGate);
      return reconcile(`mode=${message.mode}`);
    }
    case "set-selection": {
      const selection = await loadSelection();
      selection[message.group] = message.member;
      await saveSelection(selection);
      resetAuthGate(authGate);
      return reconcile(`selection=${message.group}->${message.member}`);
    }
    case "import-subscription": {
      const { importSubscription } = await import("./subscription.ts");
      const result = await importSubscription(message.url);
      if (!result.ok) {
        setState({ kind: "error", detail: `import failed: ${result.error}` });
        return state;
      }
      resetAuthGate(authGate);
      return reconcile("subscription imported");
    }
    case "refresh-subscription": {
      await refreshSubscription();
      return reconcile("subscription refreshed");
    }
  }
}

function scheduleReconcile(): void {
  chrome.alarms.create("xbond.reconcile", { periodInMinutes: 5 });
  chrome.alarms.create("xbond.subscription-refresh", { periodInMinutes: 1440 });
}

/** SW 入口装配（index.ts 调用一次；MV3 事件模型保证重复安全）。 */
export function installListeners(): void {
  chrome.webRequest.onAuthRequired.addListener(
    createAuthHandler(authGate, loadConfig, (level, message) =>
      logEvent(level, message),
    ),
    { urls: ["http://*/*", "https://*/*"] },
    ["asyncBlocking"],
  );

  chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
      if (!details.fromProxy) return;
      if (/proxy|tunnel/i.test(details.error)) recordProxyError(details.error);
    },
    { urls: ["http://*/*", "https://*/*"] },
  );

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (
      changes["xbond.config"] ||
      changes["xbond.selection"] ||
      changes["xbond.mode"] ||
      changes["xbond.enabled"]
    ) {
      proxyErrors.length = 0;
      void reconcile("storage change");
    }
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "xbond.reconcile") void reconcile("verify");
    if (alarm.name === "xbond.subscription-refresh") {
      void refreshSubscription().then(() => reconcile("subscription refresh"));
    }
  });

  chrome.runtime.onInstalled.addListener((details) => {
    scheduleReconcile();
    void reconcile(`installed ${details.reason}`);
  });

  chrome.runtime.onStartup.addListener(() => {
    scheduleReconcile();
    proxyErrors.length = 0;
    void reconcile("browser start");
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (typeof message !== "object" || message === null) return undefined;
    const typed = message as ExtensionMessage;
    if (
      typed.type !== "get-state" &&
      typed.type !== "get-events" &&
      typed.type !== "set-enabled" &&
      typed.type !== "set-mode" &&
      typed.type !== "set-selection" &&
      typed.type !== "import-subscription" &&
      typed.type !== "refresh-subscription"
    ) {
      return undefined;
    }
    void handleMessage(typed).then((result) => sendResponse(result));
    return true;
  });
}
