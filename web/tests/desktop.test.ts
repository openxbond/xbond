import assert from "node:assert/strict";
import test from "node:test";

import EN from "../src/i18n/en_US.ts";
import CN from "../src/i18n/zh_CN.ts";
import HK from "../src/i18n/zh_HK.ts";
import {
  isDesktopApp,
  resolveDesktopLocalAPIConfig,
} from "../src/lib/localapi.ts";

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
