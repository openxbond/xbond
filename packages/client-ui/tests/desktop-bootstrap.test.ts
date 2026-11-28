import assert from "node:assert/strict";
import test from "node:test";

import { errorKind } from "../src/hooks/use-action.ts";
import EN from "../src/i18n/messages/en-us.ts";
import FA from "../src/i18n/messages/fa.ts";
import KO from "../src/i18n/messages/ko.ts";
import RU from "../src/i18n/messages/ru.ts";
import CN from "../src/i18n/messages/zh-cn.ts";
import HK from "../src/i18n/messages/zh-hk.ts";
import { handleDesktopShortcut } from "../src/platform/desktop-shortcuts.ts";
import {
  clearLocalAPIToken,
  detectLocalAPIConfig,
  hasDaemonConfig,
  invokeDesktop,
  isDaemonHostedPage,
  isDaemonSecretRequired,
  isDesktopApp,
  resolveShellLocalAPIConfig,
  saveLocalAPIToken,
} from "../src/platform/local-api-bootstrap.ts";

test("isDesktopApp identifies presence vs absence of Tauri desktop shell", () => {
  globalThis.window = {} as unknown as Window & typeof globalThis;
  assert.equal(isDesktopApp(), false);

  globalThis.window = {
    __TAURI_INTERNALS__: {},
  } as unknown as Window & typeof globalThis;
  assert.equal(isDesktopApp(), true);

  // Clean up
  Reflect.deleteProperty(globalThis, "window");
});

test("resolveShellLocalAPIConfig resolves credentials from desktop IPC", async () => {
  // Non-desktop returns null
  assert.equal(await resolveShellLocalAPIConfig(), null);

  // Mock desktop with successful invoke
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string) => {
        if (cmd === "get_localapi_config") {
          return {
            addr: "127.0.0.1:5001",
            token: "desktop-token-xyz",
            is_running: true,
          };
        }
        throw new Error("unknown cmd");
      },
    },
  } as unknown as Window & typeof globalThis;

  const config = await resolveShellLocalAPIConfig();
  assert.ok(config);
  assert.equal(config.endpoint, "http://127.0.0.1:5001");
  assert.equal(config.token, "desktop-token-xyz");

  // Mock desktop with empty token returns null
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async () => ({
        addr: "127.0.0.1:5001",
        token: "",
        is_running: false,
      }),
    },
  } as unknown as Window & typeof globalThis;

  assert.equal(await resolveShellLocalAPIConfig(), null);

  // Clean up
  // @ts-expect-error Restore
  delete globalThis.window;
});

test("iPhone and iPad Tauri shells use the mobile LocalAPI command", async (t) => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  t.after(() => {
    Reflect.deleteProperty(globalThis, "window");
    if (navigatorDescriptor)
      Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  });

  const commands: string[] = [];
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command: string) => {
        commands.push(command);
        return { addr: "127.0.0.1:5001", token: "mobile-token" };
      },
    },
  } as unknown as Window & typeof globalThis;

  for (const navigator of [
    { userAgent: "Mozilla/5.0 (iPhone)", maxTouchPoints: 5 },
    { userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 5 },
    { userAgent: "Mozilla/5.0 (Linux; Android 14)", maxTouchPoints: 5 },
  ]) {
    Object.defineProperty(globalThis, "navigator", {
      value: navigator,
      configurable: true,
    });
    assert.equal(isDesktopApp(), false);
    assert.equal(invokeDesktop(), null);
    assert.deepEqual(await resolveShellLocalAPIConfig(), {
      endpoint: "http://127.0.0.1:5001",
      token: "mobile-token",
    });
  }
  assert.deepEqual(commands, Array(3).fill("plugin:xbond|get_localapi_config"));
});

test("Takeover TUN privilege notice exists across all locale dictionaries", () => {
  assert.ok(HK.settings.takeover.tunPrivilegeNotice);
  assert.ok(CN.settings.takeover.tunPrivilegeNotice);
  assert.ok(EN.settings.takeover.tunPrivilegeNotice);
  assert.match(HK.settings.takeover.tunPrivilegeNotice, /管理員/);
  assert.match(CN.settings.takeover.tunPrivilegeNotice, /管理员/);
  assert.match(EN.settings.takeover.tunPrivilegeNotice, /administrator/i);
});

test("Proxy pin and sort keys exist across locale dictionaries", () => {
  assert.equal(HK.proxies.pin, "釘選");
  assert.equal(CN.proxies.pin, "置顶");
  assert.equal(EN.proxies.pin, "Pin");

  assert.equal(HK.proxies.unpin, "取消釘選");
  assert.equal(CN.proxies.unpin, "取消置顶");
  assert.equal(EN.proxies.unpin, "Unpin");

  assert.equal(HK.proxies.pinned, "已釘選");
  assert.equal(CN.proxies.pinned, "已置顶");
  assert.equal(EN.proxies.pinned, "Pinned");
});

test("Desktop shell syncs language preference to desktop runtime", async () => {
  let invokedCommand = "";
  let invokedArgs: unknown = null;

  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args: unknown) => {
        invokedCommand = cmd;
        invokedArgs = args;
        return null;
      },
    },
  } as unknown as Window & typeof globalThis;

  const invoke = invokeDesktop();
  assert.ok(invoke);
  await invoke("set_tray_language", { lang: "zh_CN" });

  assert.equal(invokedCommand, "set_tray_language");
  assert.deepEqual(invokedArgs, { lang: "zh_CN" });

  // Test close_main_window invoke
  await invoke("close_main_window");
  assert.equal(invokedCommand, "close_main_window");

  // Clean up
  // @ts-expect-error Restore
  delete globalThis.window;
});

test("Privileged service takeover keys exist across all 6 locale dictionaries", () => {
  const dicts = [HK, CN, EN, KO, FA, RU];
  for (const dict of dicts) {
    const takeover = dict.settings.takeover;
    assert.ok(takeover.serviceInstalled);
    assert.ok(takeover.serviceInstalledDesc);
    assert.ok(takeover.installService);
    assert.ok(takeover.uninstallService);
    assert.ok(takeover.uninstallServicePrompt);
    assert.ok(takeover.uninstallServiceSuccess);
    assert.ok(takeover.uninstallServiceFailed);
    assert.ok(takeover.serviceChangeTimeout);
  }
});

test("Command palette localization keys exist across all 6 locale dictionaries", () => {
  const dicts = [HK, CN, EN, KO, FA, RU];
  for (const dict of dicts) {
    assert.ok(dict.commandPalette.title);
    assert.ok(dict.commandPalette.searchPlaceholder);
    assert.ok(dict.commandPalette.searchButton);
    assert.ok(dict.commandPalette.emptyTitle);
    assert.ok(dict.commandPalette.emptyDesc);
    assert.ok(dict.commandPalette.categories.actions);
    assert.ok(dict.commandPalette.categories.navigation);
    assert.ok(dict.commandPalette.categories.nodes);
    assert.ok(dict.commandPalette.categories.pinned);
    assert.ok(dict.commandPalette.actions.connect);
    assert.ok(dict.commandPalette.actions.disconnect);
    assert.ok(dict.commandPalette.actions.restart);
    assert.ok(dict.commandPalette.actions.ruleMode);
    assert.ok(dict.commandPalette.actions.globalMode);
    assert.ok(dict.commandPalette.actions.directMode);
    assert.ok(dict.commandPalette.actions.copyEnv);
    assert.ok(dict.commandPalette.toasts.connected);
    assert.ok(dict.commandPalette.toasts.disconnected);
    assert.ok(dict.commandPalette.toasts.restarted);
    assert.ok(dict.commandPalette.toasts.switchedMode);
    assert.ok(dict.commandPalette.toasts.envCopied);
    assert.ok(dict.commandPalette.toasts.nodeSwitched);
    assert.ok(dict.commandPalette.footer.navigate);
    assert.ok(dict.commandPalette.footer.select);
    assert.ok(dict.commandPalette.footer.close);
  }
});

test("handleDesktopShortcut dispatches keyboard shortcuts properly", () => {
  let navigatedTo = "";
  let windowClosed = false;
  const navigate = (path: string) => {
    navigatedTo = path;
  };
  const closeWindow = () => {
    windowClosed = true;
  };

  // Cmd/Ctrl + , -> /settings
  assert.equal(
    handleDesktopShortcut({ metaKey: true, key: "," }, navigate, closeWindow),
    true,
  );
  assert.equal(navigatedTo, "/settings");

  // Cmd/Ctrl + W -> closeWindow
  assert.equal(
    handleDesktopShortcut({ ctrlKey: true, key: "w" }, navigate, closeWindow),
    true,
  );
  assert.equal(windowClosed, true);

  // Cmd/Ctrl + 1..8 -> tabs
  assert.equal(
    handleDesktopShortcut({ metaKey: true, key: "1" }, navigate, closeWindow),
    true,
  );
  assert.equal(navigatedTo, "/");

  assert.equal(
    handleDesktopShortcut({ metaKey: true, key: "2" }, navigate, closeWindow),
    true,
  );
  assert.equal(navigatedTo, "/proxies");

  // Input typing does not trigger tab switching
  navigatedTo = "";
  assert.equal(
    handleDesktopShortcut(
      { metaKey: true, key: "2", isInput: true },
      navigate,
      closeWindow,
    ),
    false,
  );
  assert.equal(navigatedTo, "");

  // Cmd/Ctrl + R blocked in production
  assert.equal(
    handleDesktopShortcut(
      { metaKey: true, key: "r", isDev: false },
      navigate,
      closeWindow,
    ),
    true,
  );

  // F5 blocked in production
  assert.equal(
    handleDesktopShortcut({ key: "F5", isDev: false }, navigate, closeWindow),
    true,
  );
});

test("errorKind distinguishes local core vs remote controller network errors", () => {
  const axiosNetworkError = {
    isAxiosError: true,
    name: "AxiosError",
    message: "Network Error",
  };

  assert.equal(errorKind(axiosNetworkError, true), "networkLocal");
  assert.equal(errorKind(axiosNetworkError, false), "network");

  for (const dict of [EN, CN, HK, KO, FA, RU]) {
    assert.ok(dict.runtime.networkLocal);
    assert.ok(dict.runtime.network);
    assert.equal(dict.runtime.network.includes("CORS"), false);
  }
});

test("Daemon secret gate helpers detect controller-only pages and persist tokens", (t) => {
  const prevDocument = globalThis.document;
  const prevWindow = globalThis.window;
  const prevLocalStorage = globalThis.localStorage;
  t.after(() => {
    if (prevDocument === undefined)
      Reflect.deleteProperty(globalThis, "document");
    else globalThis.document = prevDocument;
    if (prevWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else globalThis.window = prevWindow;
    if (prevLocalStorage === undefined)
      Reflect.deleteProperty(globalThis, "localStorage");
    else globalThis.localStorage = prevLocalStorage;
  });

  const storage = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  } as unknown as Storage;
  globalThis.localStorage = mockLocalStorage;
  globalThis.window = {
    location: { search: "" },
  } as unknown as Window & typeof globalThis;

  const setMetaTags = (tags: Record<string, string>) => {
    globalThis.document = {
      querySelector: (selector: string) => {
        const match = /^meta\[name="([^"]+)"\]$/.exec(selector);
        if (!match) return null;
        const content = tags[match[1]];
        return content === undefined
          ? null
          : {
              getAttribute: (name: string) =>
                name === "content" ? content : null,
            };
      },
    } as unknown as Document;
  };

  // Pure web page (no daemon meta tags)
  setMetaTags({});
  assert.equal(isDaemonHostedPage(), false);
  assert.equal(isDaemonSecretRequired(), false);
  assert.equal(hasDaemonConfig(), false);

  // Passwordless daemon page (controller + token injected)
  setMetaTags({
    "localapi-controller": "/localapi/v0/controller/",
    "localapi-token": "auto-token",
  });
  assert.equal(isDaemonHostedPage(), true);
  assert.equal(isDaemonSecretRequired(), false);
  assert.equal(hasDaemonConfig(), true);
  assert.deepEqual(detectLocalAPIConfig(), {
    endpoint: "",
    token: "auto-token",
  });

  // Secret-protected daemon page (controller only, no token meta)
  setMetaTags({
    "localapi-controller": "/localapi/v0/controller/",
  });
  assert.equal(isDaemonHostedPage(), true);
  assert.equal(isDaemonSecretRequired(), true);
  assert.equal(hasDaemonConfig(), true);
  assert.equal(detectLocalAPIConfig(), null);

  // Stale saved address is ignored in favor of same-origin on daemon-hosted pages
  storage.set("xbond_localapi_addr", "127.0.0.1:9999");
  assert.deepEqual(saveLocalAPIToken("MySecret_123"), {
    endpoint: "",
    token: "MySecret_123",
  });
  assert.equal(storage.get("xbond_localapi_addr"), undefined);
  assert.deepEqual(detectLocalAPIConfig(), {
    endpoint: "",
    token: "MySecret_123",
  });

  clearLocalAPIToken();
  assert.equal(detectLocalAPIConfig(), null);

  for (const dict of [EN, CN, HK, KO, FA, RU]) {
    assert.ok(dict.onboarding.daemonSecretTitle);
    assert.ok(dict.onboarding.daemonSecretDesc);
    assert.ok(dict.onboarding.daemonSecretSubmit);
  }
});
