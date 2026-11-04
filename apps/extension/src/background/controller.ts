import {
  parseCommand,
  type ControlReply,
  type ExtensionCommand,
  type ExtensionSnapshot,
  type ProxyState,
  type RuleView,
} from "../shared/control.ts";
import {
  parseExtensionConfig,
  type ExtensionConfig,
} from "../shared/extension-config.ts";
import {
  normalizeDomain,
  selectionPath,
  withOverrides,
  predictRoute,
  predictGlobalRoute,
} from "../shared/routing.ts";
import { resolveLeaf } from "../shared/workspace.ts";
import { createAccount } from "./account.ts";
import { createAuthGate, createAuthHandler, resetAuthGate } from "./auth.ts";
import {
  clearProxy,
  expectedProxyValue,
  readProxySetting,
  setProxy,
  settingMatches,
} from "./proxy.ts";
import { captureRequest, flushRequests } from "./requests.ts";
import * as store from "./store.ts";

/** 请求记录监听范围：与 PAC 的代理范围一致（http/https/ws/wss）。 */
const REQUEST_FILTER = {
  urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"],
};

declare const __XBOND_API_ORIGIN__: string;
const account = createAccount(__XBOND_API_ORIGIN__);
const authGate = createAuthGate();
let state: ProxyState = { kind: "off" };
let control: chrome.proxy.LevelOfControl | null = null;
let prediction: ExtensionSnapshot["prediction"] = null;
let queue: Promise<unknown> = Promise.resolve();
let publishTimer: ReturnType<typeof setTimeout> | undefined;

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation, operation);
  queue = next.catch(() => undefined);
  return next;
}
async function cache(): Promise<ExtensionConfig | null> {
  const value = await store.loadConfig();
  return value ? parseExtensionConfig(value) : null;
}
async function release(): Promise<void> {
  const setting = await readProxySetting();
  control = setting?.levelOfControl ?? null;
  if (control === "controlled_by_this_extension") await clearProxy();
}
async function reconcileNow(): Promise<void> {
  try {
    const enabled = await store.loadEnabled();
    const tokens = await store.loadTokens();
    const pending = await store.loadPendingLogin();
    if (!enabled || !tokens || pending) {
      await release();
      resetAuthGate(authGate);
      state = {
        kind: pending ? "pending-login" : !tokens ? "signed-out" : "off",
      };
      return;
    }
    if (!(await store.configBound())) {
      await release();
      state = { kind: "no-config" };
      return;
    }
    const config = await cache();
    if (!config) {
      await release();
      state = { kind: "no-config" };
      return;
    }
    const expected = expectedProxyValue({
      config,
      selection: await store.loadSelection(),
      mode: await store.loadMode(),
      controlOrigin: __XBOND_API_ORIGIN__,
      overrides: await store.loadOverrides(),
      globalTarget: await store.loadGlobalExit(),
    });
    const setting = await readProxySetting();
    control = setting?.levelOfControl ?? null;
    if (expected === null) {
      await release();
      state = { kind: "off" };
      return;
    }
    if (
      control === "not_controllable" ||
      control === "controlled_by_other_extensions"
    ) {
      const holder = control === "not_controllable" ? "policy" : "extension";
      if (state.kind !== "control-lost")
        store.logEvent("warn", `proxy control lost: ${holder}`);
      state = { kind: "control-lost", holder };
      return;
    }
    if (!setting) throw new Error("Proxy settings unavailable");
    if (
      !settingMatches(setting, expected) ||
      control !== "controlled_by_this_extension"
    ) {
      await setProxy(expected);
      const applied = await readProxySetting();
      control = applied?.levelOfControl ?? null;
      if (
        !applied ||
        control !== "controlled_by_this_extension" ||
        !settingMatches(applied, expected)
      )
        throw new Error("Browser did not confirm proxy settings");
      store.logEvent("info", "proxy configuration applied");
    }
    state = authGate.exhausted
      ? { kind: "auth-failed", detail: "Proxy authentication failed" }
      : { kind: "ok" };
  } catch (error) {
    state = { kind: "error", detail: store.redact(String(error)) };
  }
}

function ruleViews(config: ExtensionConfig): RuleView[] {
  return config.rules.flatMap((rule) =>
    rule.kind === "domain-suffix"
      ? rule.suffixes.map((payload) => ({
          condition: "domain-suffix",
          payload,
          target: rule.target,
        }))
      : (config.ruleSets[rule.id] ?? []).flatMap((ruleSet) => [
          ...(ruleSet.domain ?? []).map((payload) => ({
            condition: "domain",
            payload,
            target: rule.target,
          })),
          ...(ruleSet.domain_suffix ?? []).map((payload) => ({
            condition: "domain-suffix",
            payload,
            target: rule.target,
          })),
          ...(ruleSet.domain_keyword ?? []).map((payload) => ({
            condition: "domain-keyword",
            payload,
            target: rule.target,
          })),
          ...(ruleSet.ip_cidr ?? [])
            .filter((payload) => !payload.includes(":"))
            .map((payload) => ({
              condition: "ip-cidr",
              payload,
              target: rule.target,
            })),
        ]),
  );
}
export async function snapshot(): Promise<ExtensionSnapshot> {
  const [
    tokens,
    pending,
    loginEnded,
    configMeta,
    selection,
    quota,
    preferences,
    overrides,
    recording,
    requests,
    events,
    connectivity,
    enabled,
    mode,
    bound,
  ] = await Promise.all([
    store.loadTokens(),
    store.loadPendingLogin(),
    store.loadLoginEnded(),
    store.loadConfigMeta(),
    store.loadSelection(),
    store.loadQuota(),
    store.loadPreferences(),
    store.loadOverrides(),
    store.loadRecording(),
    store.loadRequests(),
    store.loadEvents(),
    store.loadConnectivity(),
    store.loadEnabled(),
    store.loadMode(),
    store.configBound(),
  ]);
  let config: ExtensionConfig | null = null;
  let cacheError: string | null = null;
  try {
    if (tokens && bound) config = await cache();
  } catch (error) {
    cacheError = store.redact(String(error));
  }
  const valid = config;
  const globalExit =
    (await store.loadGlobalExit()) ||
    valid?.groups.find((group) => group.type === "select")?.name ||
    valid?.final ||
    "";
  const overrideErrors = overrides
    .filter((rule) => rule.enabled)
    .flatMap((rule) => {
      if (!valid) return [];
      try {
        resolveLeaf(valid, selection, rule.target);
        return [];
      } catch {
        return [rule.id];
      }
    });
  return {
    state,
    enabled,
    mode,
    signedIn: !!tokens,
    pendingLogin: pending
      ? {
          userCode: pending.userCode,
          verificationUri:
            pending.verificationUriComplete ?? pending.verificationUri,
          expiresAt: pending.expiresAt,
        }
      : null,
    loginEnded,
    config: {
      available: !!valid,
      updatedAt: configMeta.updatedAt,
      error: cacheError ?? configMeta.error,
    },
    groups:
      valid?.groups.map((group) => {
        const selected = group.members.includes(selection[group.name])
          ? selection[group.name]
          : (group.members.find((name) => name !== group.name) ?? "");
        return {
          name: group.name,
          type: group.type,
          members: group.members,
          selected,
          path: selectionPath(valid, selection, group.name),
        };
      }) ?? [],
    nodes:
      valid?.nodes.map(({ name, server, port }) => ({ name, server, port })) ??
      [],
    rules: valid ? ruleViews(valid) : [],
    final: valid?.final ?? "",
    selection,
    globalExit,
    globalPath: valid ? selectionPath(valid, selection, globalExit) : [],
    quota: tokens ? quota : null,
    preferences,
    overrides,
    overrideErrors,
    recording,
    requests,
    events: events.map((event) => ({
      ...event,
      message: store.redact(event.message),
    })),
    connectivity,
    control,
    prediction,
  };
}
async function publish(): Promise<void> {
  const reply: ControlReply = { ok: true, snapshot: await snapshot() };
  chrome.runtime.sendMessage(
    { type: "snapshot", ...reply },
    () => void chrome.runtime.lastError,
  );
}
function notify(): void {
  if (publishTimer !== undefined) return;
  publishTimer = setTimeout(() => {
    publishTimer = undefined;
    void serialized(publish).catch(() => undefined);
  }, 150);
}
export async function reconcile(): Promise<void> {
  await serialized(async () => {
    await reconcileNow();
    notify();
  });
}

async function transact(
  update: () => Promise<void>,
  undo: () => Promise<void>,
): Promise<void> {
  prediction = null;
  await update();
  resetAuthGate(authGate);
  await store.saveConnectivity({ status: "unknown", target: "" });
  await reconcileNow();
  if (
    state.kind === "error" ||
    state.kind === "control-lost" ||
    state.kind === "no-config" ||
    state.kind === "signed-out"
  ) {
    const failure = state;
    await undo();
    await reconcileNow();
    state = failure;
    throw new Error(failure.kind);
  }
}
async function dispatch(command: ExtensionCommand): Promise<void> {
  switch (command.type) {
    case "get-snapshot":
      return;
    case "reconcile":
      await reconcileNow();
      return;
    case "set-enabled": {
      const previous = await store.loadEnabled();
      if (
        command.enabled &&
        (!(await store.loadTokens()) || !(await store.configBound()))
      )
        throw new Error("Sign in and load a valid configuration first");
      await transact(
        () => store.saveEnabled(command.enabled),
        () => store.saveEnabled(previous),
      );
      return;
    }
    case "set-mode": {
      const previous = await store.loadMode();
      await transact(
        () => store.saveMode(command.mode),
        () => store.saveMode(previous),
      );
      return;
    }
    case "set-selection": {
      const config = await cache();
      const group = config?.groups.find((item) => item.name === command.group);
      if (!config || !group || !group.members.includes(command.member))
        throw new Error("Unknown strategy member");
      const previous = await store.loadSelection();
      const next = { ...previous, [command.group]: command.member };
      resolveLeaf(config, next, command.group);
      await transact(
        () => store.saveSelection(next),
        () => store.saveSelection(previous),
      );
      store.logEvent(
        "info",
        `selection changed: ${command.group} -> ${command.member}`,
      );
      return;
    }
    case "set-preferences":
      await store.savePreferences(command.preferences);
      return;
    case "set-global-exit": {
      const config = await cache();
      if (!config) throw new Error("No configuration");
      resolveLeaf(config, await store.loadSelection(), command.target);
      const previous = await store.loadGlobalExit();
      await transact(
        () => store.saveGlobalExit(command.target),
        () => store.saveGlobalExit(previous),
      );
      return;
    }
    case "predict-route": {
      const config = await cache();
      if (!config || !(await store.loadTokens()))
        throw new Error("No active configuration");
      const mode = await store.loadMode();
      const selection = await store.loadSelection();
      const overrides = await store.loadOverrides();
      const { action: _action, ...result } =
        mode === "global"
          ? predictGlobalRoute(
              config,
              selection,
              overrides,
              (await store.loadGlobalExit()) || undefined,
              command.host,
            )
          : predictRoute(
              withOverrides(config, overrides),
              selection,
              command.host,
            );
      prediction = result;
      return;
    }
    case "save-override": {
      const config = await cache();
      if (!config) throw new Error("No configuration");
      const previous = await store.loadOverrides();
      const rule = {
        ...command.override,
        domain: normalizeDomain(command.override.domain),
      };
      if (!rule.id || rule.id.length > 80)
        throw new Error("Invalid exception ID");
      if (
        previous.some(
          (item) =>
            item.id !== rule.id &&
            item.domain === rule.domain &&
            item.match === rule.match,
        )
      )
        throw new Error("This domain and matching scope already exist");
      const next = [...previous.filter((item) => item.id !== rule.id), rule];
      if (next.length > 200) throw new Error("At most 200 website exceptions");
      withOverrides(config, next);
      await transact(
        () => store.saveOverrides(next),
        () => store.saveOverrides(previous),
      );
      store.logEvent("info", "website exception saved");
      return;
    }
    case "delete-override": {
      const previous = await store.loadOverrides();
      await transact(
        () =>
          store.saveOverrides(
            previous.filter((item) => item.id !== command.id),
          ),
        () => store.saveOverrides(previous),
      );
      return;
    }
    case "login-start": {
      if (await store.loadPendingLogin()) return;
      if (await store.loadTokens()) throw new Error("Already signed in");
      await store.clearLoginEnded();
      const result = await account.startLogin((url) =>
        chrome.tabs.create({ url }),
      );
      if (result.kind === "error") throw new Error(result.detail);
      schedulePoll(result.pending.intervalSeconds);
      await reconcileNow();
      return;
    }
    case "login-cancel":
      await account.cancelLogin();
      await reconcileNow();
      return;
    case "logout":
      await store.saveEnabled(false);
      await store.saveRecording(false);
      await flushRequests();
      await store.saveRequests([]);
      await account.logout();
      await reconcileNow();
      return;
    case "refresh-config": {
      const result = await account.refreshConfig();
      await reconcileNow();
      if (!result)
        throw new Error(
          "Configuration update failed; the last valid configuration was preserved",
        );
      return;
    }
    case "set-recording":
      await store.saveRecording(command.enabled);
      if (!command.enabled) {
        await flushRequests();
        await store.saveRequests(
          (await store.loadRequests()).map((record) =>
            record.status === "pending"
              ? { ...record, status: "interrupted" }
              : record,
          ),
        );
      }
      return;
    case "clear-requests":
      await flushRequests();
      await store.saveRequests([]);
      return;
    case "clear-events":
      await store.clearEvents();
      return;
    case "check-connectivity": {
      await reconcileNow();
      if (state.kind !== "ok")
        throw new Error(
          "Enable the proxy and resolve configuration or control errors first",
        );
      const target = "https://www.gstatic.com/generate_204";
      await store.saveConnectivity({ status: "checking", target });
      await publish();
      const started = Date.now();
      try {
        await fetch(target, {
          mode: "no-cors",
          cache: "no-store",
          credentials: "omit",
          signal: AbortSignal.timeout(8000),
        });
        await store.saveConnectivity({
          status: "ok",
          target,
          at: Date.now(),
          duration: Date.now() - started,
        });
      } catch (error) {
        await store.saveConnectivity({
          status: "failed",
          target,
          at: Date.now(),
          error: store.redact(String(error)),
        });
      }
      return;
    }
  }
}
export async function handleCommand(
  command: ExtensionCommand,
): Promise<ControlReply> {
  return serialized(async () => {
    try {
      await dispatch(command);
      const current = await snapshot();
      notify();
      return { ok: true, snapshot: current };
    } catch (error) {
      store.logEvent("error", String(error));
      notify();
      return {
        ok: false,
        error: store.redact(String(error)),
        snapshot: await snapshot(),
      };
    }
  });
}
function schedulePoll(seconds: number): void {
  chrome.alarms.create("xbond.device-poll", {
    when: Date.now() + Math.max(5, seconds) * 1000,
  });
}
export function installListeners(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const command = parseCommand(message);
    if (!command) return;
    void handleCommand(command)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ ok: false, error: store.redact(String(error)) }),
      );
    return true;
  });
  chrome.webRequest.onAuthRequired.addListener(
    createAuthHandler(
      authGate,
      async () =>
        (await store.loadEnabled()) &&
        (await store.loadMode()) !== "direct" &&
        (await store.loadTokens()) &&
        (await store.configBound())
          ? cache()
          : null,
      (level, message) => {
        store.logEvent(level, message);
        if (level === "error") {
          state = {
            kind: "auth-failed",
            detail: "Proxy authentication failed",
          };
          notify();
        }
      },
    ),
    { urls: ["http://*/*", "https://*/*"] },
    ["asyncBlocking"],
  );
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => captureRequest("start", details, notify),
    REQUEST_FILTER,
  );
  chrome.webRequest.onCompleted.addListener((details) => {
    captureRequest("completed", details, notify);
    // 入口不可达后的证据化恢复：观察到请求重新完成即重核对（设置与控制权
    // 仍须通过）；无需等 5 分钟核对兜底。
    if (state.kind === "unreachable") void reconcile();
  }, REQUEST_FILTER);
  chrome.webRequest.onErrorOccurred.addListener((details) => {
    captureRequest("failed", details, notify);
    if (state.kind === "ok" && /PROXY|TUNNEL/i.test(details.error)) {
      state = { kind: "unreachable", detail: store.redact(details.error) };
      notify();
    }
  }, REQUEST_FILTER);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === "local" &&
      [
        store.CONFIG_KEY,
        store.ENABLED_KEY,
        store.MODE_KEY,
        store.SELECTION_KEY,
        store.OVERRIDES_KEY,
        store.GLOBAL_EXIT_KEY,
      ].some((key) => key in changes)
    )
      void reconcile();
    else notify();
  });
  chrome.proxy.settings.onChange.addListener(() => void reconcile());
  chrome.alarms.onAlarm.addListener((alarm) => {
    void serialized(async () => {
      if (alarm.name === "xbond.device-poll") {
        const result = await account.pollOnce();
        const pending = await store.loadPendingLogin();
        if (result === "pending" && pending)
          schedulePoll(pending.intervalSeconds);
      }
      if (
        alarm.name === "xbond.config-refresh" &&
        (await store.loadPreferences()).autoUpdate &&
        (await store.loadTokens())
      )
        await account.refreshConfig();
      await reconcileNow();
      notify();
    }).catch((error) => store.logEvent("error", String(error)));
  });
  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create("xbond.reconcile", { periodInMinutes: 5 });
    chrome.alarms.create("xbond.config-refresh", { periodInMinutes: 1440 });
    void reconcile();
  });
  chrome.runtime.onStartup.addListener(
    () =>
      void serialized(async () => {
        if (!(await store.loadPreferences()).restore)
          await store.saveEnabled(false);
        if (await store.loadTokens()) await account.refreshConfig();
        await reconcileNow();
        notify();
      }).catch((error) => store.logEvent("error", String(error))),
  );
}
