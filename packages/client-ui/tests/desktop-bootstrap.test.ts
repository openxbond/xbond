import assert from "node:assert/strict";
import test from "node:test";

import EN from "../src/i18n/messages/en-us.ts";
import FA from "../src/i18n/messages/fa.ts";
import KO from "../src/i18n/messages/ko.ts";
import CN from "../src/i18n/messages/zh-cn.ts";
import HK from "../src/i18n/messages/zh-hk.ts";
import { handleDesktopShortcut } from "../src/platform/desktop-shortcuts.ts";
import {
  invokeDesktop,
  isDesktopApp,
  resolveDesktopLocalAPIConfig,
} from "../src/platform/local-api-bootstrap.ts";

test("isDesktopApp identifies presence vs absence of Tauri desktop shell", () => {
  // @ts-expect-error Mock global window
  globalThis.window = {} as unknown as Window & typeof globalThis;
  assert.equal(isDesktopApp(), false);

  // @ts-expect-error Mock Tauri
  globalThis.window = {
    __TAURI_INTERNALS__: {},
  } as unknown as Window & typeof globalThis;
  assert.equal(isDesktopApp(), true);

  // Clean up
  // @ts-expect-error Restore
  delete globalThis.window;
});

test("resolveDesktopLocalAPIConfig resolves credentials from desktop IPC", async () => {
  // Non-desktop returns null
  assert.equal(await resolveDesktopLocalAPIConfig(), null);

  // Mock desktop with successful invoke
  // @ts-expect-error Mock global window
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

  const config = await resolveDesktopLocalAPIConfig();
  assert.ok(config);
  assert.equal(config.endpoint, "http://127.0.0.1:5001");
  assert.equal(config.token, "desktop-token-xyz");

  // Mock desktop with empty token returns null
  // @ts-expect-error Mock global window
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async () => ({
        addr: "127.0.0.1:5001",
        token: "",
        is_running: false,
      }),
    },
  } as unknown as Window & typeof globalThis;

  assert.equal(await resolveDesktopLocalAPIConfig(), null);

  // Clean up
  // @ts-expect-error Restore
  delete globalThis.window;
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

  // @ts-expect-error Mock global window
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

test("Desktop system service settings keys exist across all 5 locale dictionaries", () => {
  const dicts = [HK, CN, EN, KO, FA];
  for (const dict of dicts) {
    assert.ok(dict.settings.desktop.systemService);
    assert.ok(dict.settings.desktop.systemServiceDesc);
    assert.ok(dict.settings.desktop.serviceInstalled);
    assert.ok(dict.settings.desktop.serviceNotInstalled);
    assert.ok(dict.settings.desktop.serviceInstalling);
    assert.ok(dict.settings.desktop.installService);
    assert.ok(dict.settings.desktop.serviceReady);
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
  assert.equal(navigatedTo, "/connect");

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
