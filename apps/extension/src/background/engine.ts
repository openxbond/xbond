// 引擎编排：状态机 + 恢复循环。MV3 SW 随时休眠，一切状态决策都从 storage
// 重新出发（reconcile），浏览器事件（onInstalled/onStartup/onAlarm/存储变化）
// 都是 reconcile 的触发器；每次 reconcile 都核对 chrome.proxy 的实际设置与
// levelOfControl，能自愈就自愈，不能就上报显式状态。

import { parseExtensionConfig, InvalidConfigError } from "../shared/config.ts";
import type {
  DiagnosticEvent,
  ExtensionConfig,
  ExtensionMessage,
  ProxyState,
  StateMessage,
} from "../shared/types.ts";
import { createAccount } from "./account.ts";
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
  loadEntitlement,
  loadEvents,
  loadPendingLogin,
  loadPrefs,
  loadTokens,
  logEvent,
  saveConfig,
  savePrefs,
} from "./store.ts";

/** 控制通道 API origin（构建期注入）：账户与配置拉取都走它，bypass 列表一致。 */
declare const __XBOND_API_ORIGIN__: string;

/** 入口连续失败的判定窗口：60 秒内 5 次代理层错误 → unreachable。 */
const UNREACHABLE_WINDOW_MS = 60_000;
const UNREACHABLE_THRESHOLD = 5;

let state: ProxyState = { kind: "off" };

const authGate = createAuthGate();
const account = createAccount(__XBOND_API_ORIGIN__);
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

/** 登录轮询：一次端点轮询；仍 pending 则续排下一次（浏览器对短 alarm 有下限节流）。 */
function scheduleDevicePoll(afterSeconds: number): void {
  chrome.alarms.create("xbond.device-poll", {
    when: Date.now() + afterSeconds * 1000,
  });
}

async function devicePollTick(): Promise<void> {
  const pending = await loadPendingLogin();
  if (!pending) return;
  const result = await account.pollOnce();
  if (result.kind === "pending") {
    scheduleDevicePoll(Math.max(pending.intervalSeconds, 5));
    return;
  }
  await reconcile("device login finished");
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

/**
 * 中心收敛：读偏好与配置，核对实际代理设置，自愈或上报。reason 进诊断日志。
 */
export async function reconcile(reason: string): Promise<ProxyState> {
  const prefs = await loadPrefs();
  const config = await loadConfig();

  if (!prefs.enabled) {
    await releaseIfControlled("disabled");
    resetAuthGate(authGate);
    setState({ kind: "off" });
    return state;
  }

  if (!config) {
    await releaseIfControlled("no-config");
    const pending = await loadPendingLogin();
    if (pending) {
      setState({
        kind: "pending-login",
        userCode: pending.userCode,
        verificationUri: pending.verificationUri,
        verificationUriComplete: pending.verificationUriComplete,
        expiresAt: pending.expiresAt,
      });
      return state;
    }
    if (await loadTokens()) {
      // 有凭据但还没有（可用的）配置：登录完成但拉取失败，等下一轮刷新。
      setState({ kind: "no-config" });
      logEvent("warn", `enabled with credentials but no config (${reason})`);
      return state;
    }
    setState({ kind: "signed-out" });
    logEvent("info", `enabled while signed out (${reason})`);
    return state;
  }

  const expected = expectedProxyValue(config, prefs.mode);
  let setting: Awaited<ReturnType<typeof readProxySetting>>;
  try {
    setting = await readProxySetting();
  } catch (error) {
    setState({
      kind: "error",
      detail: `proxy settings unreadable: ${String(error)}`,
    });
    logEvent("error", `proxy settings unreadable: ${String(error)}`);
    return state;
  }

  // 控制权三类：策略不可夺（not_controllable）、他人持有、自己可控。前两类
  // 都不尝试自愈——夺权会打架，如实上报。
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

  if (!settingMatches(setting, expected)) {
    try {
      await setProxy(expected);
      logEvent(
        "info",
        `proxy applied (${prefs.mode}) on ${config.ingress.hosts[0]}:${config.ingress.port} — ${reason}`,
      );
    } catch (error) {
      setState({
        kind: "error",
        detail: `proxy apply failed: ${String(error)}`,
      });
      logEvent("error", `proxy apply failed: ${String(error)}`);
      return state;
    }
  } else if (reason !== "verify") {
    logEvent("info", `reconcile ${reason}: settings already correct`);
  }

  setState({
    kind: "ok",
    mode: prefs.mode,
    label: config.label || config.ingress.hosts[0],
    issuanceVersion: config.issuanceVersion,
    entitlement: (await loadEntitlement()) ?? undefined,
  });
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

/** 消息入口：popup / 管理页的唯一控制面。 */
export async function handleMessage(
  message: ExtensionMessage,
): Promise<ProxyState | { events: DiagnosticEvent[] }> {
  switch (message.type) {
    case "get-state":
      return state;
    case "get-events":
      return { events: await loadEvents() };
    case "set-enabled": {
      const prefs = await loadPrefs();
      await savePrefs({ ...prefs, enabled: message.enabled });
      return reconcile(message.enabled ? "enabled" : "disabled");
    }
    case "set-mode": {
      const prefs = await loadPrefs();
      await savePrefs({ ...prefs, mode: message.mode });
      resetAuthGate(authGate);
      return reconcile(`mode=${message.mode}`);
    }
    case "login-start": {
      const pending = await loadPendingLogin();
      if (pending) {
        // 已有进行中的登录：不重复发起，直接回当前码。
        return {
          kind: "pending-login",
          userCode: pending.userCode,
          verificationUri: pending.verificationUri,
          verificationUriComplete: pending.verificationUriComplete,
          expiresAt: pending.expiresAt,
        };
      }
      const state2 = await account.startLogin((url) =>
        chrome.tabs.create({ url }),
      );
      if (state2.kind === "pending-login") scheduleDevicePoll(5);
      await reconcile("login started");
      return state2;
    }
    case "login-cancel": {
      await account.cancelLogin();
      return reconcile("login cancelled");
    }
    case "logout": {
      await account.logout();
      return reconcile("logout");
    }
    case "refresh-config": {
      await account.refreshConfig();
      return reconcile("manual config refresh");
    }
    case "set-manual-config": {
      let config: ExtensionConfig;
      try {
        config = parseExtensionConfig(message.config);
      } catch (error) {
        const detail =
          error instanceof InvalidConfigError ? error.message : String(error);
        setState({ kind: "invalid-config", detail });
        logEvent("warn", `invalid manual config: ${detail}`);
        return state;
      }
      await saveConfig(config);
      resetAuthGate(authGate);
      return reconcile("manual config");
    }
  }
}

/** SW 入口装配（index.ts 调用一次；重复装配由 MV3 事件模型保证幂等）。 */
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
      // 代理层失败（连接失败 / 隧道失败 / 认证失败）都计入不可达窗口。
      if (/proxy|tunnel/i.test(details.error)) recordProxyError(details.error);
    },
    { urls: ["http://*/*", "https://*/*"] },
  );

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes["xbond.config"] || changes["xbond.prefs"]) {
      proxyErrors.length = 0;
      void reconcile("storage change");
    }
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "xbond.reconcile") void reconcile("verify");
    if (alarm.name === "xbond.config-refresh") void account.refreshConfig();
    if (alarm.name === "xbond.device-poll") void devicePollTick();
  });

  chrome.runtime.onInstalled.addListener((details) => {
    chrome.alarms.create("xbond.reconcile", { periodInMinutes: 5 });
    chrome.alarms.create("xbond.config-refresh", { periodInMinutes: 1440 });
    void reconcile(`installed ${details.reason}`);
  });

  chrome.runtime.onStartup.addListener(() => {
    // 浏览器重启：凭据仍在 storage.local，重新核对并恢复代理设置。
    chrome.alarms.create("xbond.config-refresh", { periodInMinutes: 1440 });
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
      typed.type !== "set-manual-config" &&
      typed.type !== "login-start" &&
      typed.type !== "login-cancel" &&
      typed.type !== "logout" &&
      typed.type !== "refresh-config"
    ) {
      return undefined;
    }
    void handleMessage(typed).then((result) => sendResponse(result));
    return true; // 异步 sendResponse
  });
}
