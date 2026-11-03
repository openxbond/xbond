// Browser-only integration fixture. Not a Vite production entry or public asset.
// The real background controller, storage adapter, message protocol and UI run
// here; only the Chrome platform and external HTTP boundaries are simulated.
import {
  handleCommand,
  installListeners,
  reconcile,
} from "../../src/background/controller.ts";
import { parseCommand } from "../../src/shared/control.ts";

const params = new URLSearchParams(location.search);
const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>();
const event = (name: string) => ({
  addListener: (fn: (...args: unknown[]) => unknown) => {
    const list = listeners.get(name) ?? [];
    list.push(fn);
    listeners.set(name, list);
  },
  removeListener: (fn: (...args: unknown[]) => unknown) =>
    listeners.set(
      name,
      (listeners.get(name) ?? []).filter((item) => item !== fn),
    ),
});
const emit = (name: string, ...args: unknown[]) => {
  for (const fn of listeners.get(name) ?? []) fn(...args);
};
const nodes = Array.from(
  { length: Number(params.get("count") ?? 12) },
  (_, i) => ({
    name:
      i === 0
        ? "JP Demo Tokyo 202 - A long, readable node name"
        : i === 1
          ? "HK Demo Hong Kong 301"
          : `SG Demo Singapore ${i + 1}`,
    server: `edge-${i}.example.org`,
    port: 443,
    password: (i + 1).toString(16).padStart(32, "0"),
  }),
);
const config = {
  version: 1,
  proxyToken: "px-" + "ab".repeat(24),
  nodes,
  groups: [
    {
      name: "Default",
      type: "select",
      members: [
        "Manual",
        "Auto",
        "DIRECT",
        "REJECT",
        ...nodes.map((n) => n.name),
      ],
    },
    { name: "Manual", type: "select", members: nodes.map((n) => n.name) },
    { name: "Auto", type: "urltest", members: nodes.map((n) => n.name) },
    { name: "Domestic", type: "select", members: ["DIRECT", "Default"] },
  ],
  rules: [
    { kind: "ruleset", id: "Domestic", target: "Domestic" },
    { kind: "domain-suffix", suffixes: ["example.org"], target: "Default" },
  ],
  ruleSets: {
    Domestic: [{ domain_suffix: ["cn.example"], ip_cidr: ["10.0.0.0/8"] }],
  },
  final: "Default",
};
const local: Record<string, unknown> = {
  "xbond.refresh": "synthetic-refresh",
  "xbond.config": config,
  "xbond.config.bound": true,
  "xbond.config.meta": { updatedAt: Date.now(), error: null },
  "xbond.quota": {
    uploadBytes: 1024 ** 3,
    downloadBytes: 35 * 1024 ** 3,
    totalBytes: 100 * 1024 ** 3,
    expiresAt: Date.now() / 1000 + 86400 * 20,
  },
  "xbond.enabled": params.get("scenario") !== "off",
  "xbond.selection": { Default: "Manual", Manual: nodes[0]?.name },
  "xbond.preferences": {
    theme: params.get("theme") ?? "light",
    language: params.get("lang") ?? "zh_CN",
    autoUpdate: true,
    restore: true,
    focusedGroup: "Default",
  },
  "xbond.events": [
    {
      at: Date.now(),
      level: "info",
      message: "SYNTHETIC FIXTURE: configuration loaded",
    },
  ],
};
const session: Record<string, unknown> = {
  "xbond.access": {
    token: "synthetic-access",
    expiresAt: Date.now() + 3600000,
  },
};
if (params.get("scenario") === "login") {
  delete local["xbond.refresh"];
  delete session["xbond.access"];
}
if (params.get("scenario") === "empty") {
  delete local["xbond.config"];
  local["xbond.config.bound"] = false;
}
let holder =
  params.get("scenario") === "conflict"
    ? "controlled_by_other_extensions"
    : "controllable_by_this_extension";
let setting: unknown = { mode: "system" };
function area(name: string, data: Record<string, unknown>) {
  return {
    get: (keys: string[], callback: (items: Record<string, unknown>) => void) =>
      queueMicrotask(() =>
        callback(
          Object.fromEntries(
            keys.filter((k) => k in data).map((k) => [k, data[k]]),
          ),
        ),
      ),
    set: (items: Record<string, unknown>, callback?: () => void) => {
      const changes = Object.fromEntries(
        Object.entries(items).map(([key, value]) => [
          key,
          { oldValue: data[key], newValue: value },
        ]),
      );
      Object.assign(data, structuredClone(items));
      queueMicrotask(() => {
        callback?.();
        emit("storage", changes, name);
      });
    },
    remove: (keys: string[], callback?: () => void) => {
      for (const key of keys) delete data[key];
      queueMicrotask(() => callback?.());
    },
  };
}
Object.defineProperty(window, "chrome", {
  configurable: true,
  value: {
    runtime: {
      getURL: (path: string) => new URL(path, location.origin + "/").href,
      lastError: undefined,
      onMessage: event("message"),
      onInstalled: event("installed"),
      onStartup: event("startup"),
      sendMessage: (message: unknown, callback?: (result: unknown) => void) => {
        if (parseCommand(message))
          void handleCommand(parseCommand(message)!).then((result) =>
            callback?.(result),
          );
        else {
          emit("message", message, {}, () => {});
          callback?.(undefined);
        }
      },
    },
    storage: {
      local: area("local", local),
      session: area("session", session),
      onChanged: event("storage"),
    },
    proxy: {
      settings: {
        get: (_details: unknown, callback: (value: unknown) => void) =>
          queueMicrotask(() =>
            callback({ value: setting, levelOfControl: holder }),
          ),
        set: (details: { value: unknown }, callback: () => void) => {
          setting = structuredClone(details.value);
          holder = "controlled_by_this_extension";
          queueMicrotask(() => {
            callback();
            emit("proxy", { value: setting, levelOfControl: holder });
          });
        },
        clear: (_details: unknown, callback: () => void) => {
          holder = "controllable_by_this_extension";
          setting = { mode: "system" };
          queueMicrotask(callback);
        },
        onChange: event("proxy"),
      },
    },
    webRequest: {
      onAuthRequired: event("auth"),
      onBeforeRequest: event("before"),
      onCompleted: event("completed"),
      onErrorOccurred: event("failed"),
    },
    alarms: { create: () => {}, onAlarm: event("alarm") },
    tabs: {
      create: ({ url }: { url: string }) => {
        const next = url.includes("src/page/index.html")
          ? new URL("manager.html" + new URL(url).hash, location.href).href
          : url.includes("device")
            ? new URL("manager.html#account", location.href).href
            : url;
        window.open(next, "_blank");
      },
    },
  },
});
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
    location.href,
  );
  if (url.pathname === "/api/subscription/config")
    return Response.json(config, {
      headers: {
        "subscription-userinfo": `upload=1073741824; download=37580963840; total=107374182400; expire=${Math.floor(Date.now() / 1000) + 86400 * 20}`,
      },
    });
  if (url.pathname === "/api/auth/device/code")
    return Response.json({
      device_code: "synthetic-device",
      user_code: "DEMO-ONLY",
      verification_uri: "https://cloud.example.org/auth/activate",
      expires_in: 600,
      interval: 5,
    });
  if (url.pathname === "/api/auth/oauth2/token")
    return Response.json({ error: "authorization_pending" }, { status: 400 });
  if (url.hostname === "www.gstatic.com")
    return new Response(null, { status: 204 });
  if (url.origin === location.origin) return originalFetch(input, init);
  throw new Error("External network disabled by isolated UI fixture");
};
installListeners();
await reconcile();
await import("../../src/ui/main.tsx");
const fixture = document.createElement("div");
fixture.style.cssText =
  "position:fixed;bottom:0;left:0;font:10px system-ui;color:#666;background:#fff;padding:2px 5px;z-index:30";
fixture.textContent = "ISOLATED UI · SYNTHETIC DATA · NO REAL PROXY";
if (document.body.dataset.surface !== "popup") {
  const button = document.createElement("button");
  button.textContent = "Generate synthetic request";
  button.onclick = () => {
    const id = String(Date.now());
    emit("before", {
      requestId: id,
      url: "https://docs.example.org/private?neverStore=this",
      type: "main_frame",
      timeStamp: Date.now(),
    });
    setTimeout(
      () =>
        emit("completed", {
          requestId: id,
          url: "https://docs.example.org/private?neverStore=this",
          type: "main_frame",
          timeStamp: Date.now(),
        }),
      100,
    );
  };
  fixture.append(button);
}
document.body.append(fixture);
