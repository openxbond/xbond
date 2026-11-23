import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import EN from "../src/i18n/messages/en-us.ts";
import FA from "../src/i18n/messages/fa.ts";
import KO from "../src/i18n/messages/ko.ts";
import CN from "../src/i18n/messages/zh-cn.ts";
import HK from "../src/i18n/messages/zh-hk.ts";
import {
  canOpenDesktopNotificationSettings,
  getMobileNotificationPermissionState,
  openDesktopNotificationSettings,
  openMobileNotificationSettings,
  promptMobileNotificationOnFirstConnect,
  requestMobileNotificationPermission,
} from "../src/platform/notifications.ts";

function withMockShell(
  userAgent: string,
  handler: (cmd: string, args?: Record<string, unknown>) => unknown,
  run: () => Promise<void>,
): Promise<void> {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: Record<string, unknown>) =>
        handler(cmd, args),
    },
  } as unknown as Window & typeof globalThis;
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent, maxTouchPoints: 0 },
    configurable: true,
  });
  return run().finally(() => {
    Reflect.deleteProperty(globalThis, "window");
    if (navigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    }
  });
}

test("mobile first connect prompts once when state is prompt and never repeats", async () => {
  const prefs = new Map<string, string>();
  const calls: string[] = [];

  await withMockShell(
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36",
    (cmd, args) => {
      calls.push(cmd);
      if (cmd === "plugin:xbond|get_preference") {
        return prefs.get(String(args?.key)) ?? null;
      }
      if (cmd === "plugin:xbond|set_preference") {
        prefs.set(String(args?.key), String(args?.value));
        return true;
      }
      if (cmd === "plugin:xbond|get_notification_permission_state") {
        return "prompt";
      }
      if (cmd === "plugin:xbond|request_notification_permission") {
        return false; // User declined; must not re-prompt later
      }
      return null;
    },
    async () => {
      await promptMobileNotificationOnFirstConnect();
      await promptMobileNotificationOnFirstConnect();
    },
  );

  assert.deepEqual(calls, [
    "plugin:xbond|get_preference",
    "plugin:xbond|get_notification_permission_state",
    "plugin:xbond|set_preference",
    "plugin:xbond|request_notification_permission",
  ]);
  assert.equal(prefs.get("notif_prompted_on_connect"), "1");
});

test("mobile first connect skips prompt when permission already granted or denied", async () => {
  const calls: string[] = [];

  await withMockShell(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    (cmd) => {
      calls.push(cmd);
      if (cmd === "plugin:xbond|get_preference") return null;
      if (cmd === "plugin:xbond|get_notification_permission_state") {
        return "denied";
      }
      if (cmd === "plugin:xbond|set_preference") return true;
      return null;
    },
    async () => {
      await promptMobileNotificationOnFirstConnect();
    },
  );

  assert.deepEqual(calls, [
    "plugin:xbond|get_preference",
    "plugin:xbond|get_notification_permission_state",
    "plugin:xbond|set_preference",
  ]);
});

test("mobile notification settings helpers invoke xbond plugin commands", async () => {
  const calls: string[] = [];

  await withMockShell(
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36",
    (cmd) => {
      calls.push(cmd);
      if (cmd === "plugin:xbond|get_notification_permission_state") {
        return "granted";
      }
      if (cmd === "plugin:xbond|request_notification_permission") return true;
      if (cmd === "plugin:xbond|open_notification_settings") return true;
      return null;
    },
    async () => {
      assert.equal(await getMobileNotificationPermissionState(), "granted");
      assert.equal(await requestMobileNotificationPermission(), true);
      assert.equal(await openMobileNotificationSettings(), true);
    },
  );

  assert.deepEqual(calls, [
    "plugin:xbond|get_notification_permission_state",
    "plugin:xbond|request_notification_permission",
    "plugin:xbond|open_notification_settings",
  ]);
});

test("desktop notification helpers use desktop commands and skip mobile plugin", async () => {
  const calls: string[] = [];

  await withMockShell(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36",
    (cmd) => {
      calls.push(cmd);
      if (cmd === "can_open_notification_settings") return true;
      return null;
    },
    async () => {
      assert.equal(await getMobileNotificationPermissionState(), null);
      assert.equal(await canOpenDesktopNotificationSettings(), true);
      await openDesktopNotificationSettings();
    },
  );

  assert.deepEqual(calls, [
    "can_open_notification_settings",
    "open_notification_settings",
  ]);
});

test("notification settings keys exist across all 5 locale dictionaries", () => {
  const dicts = [HK, CN, EN, KO, FA];
  for (const dict of dicts) {
    assert.ok(dict.settings.desktop.notifications);
    assert.ok(dict.settings.desktop.notificationsDesc);
    assert.ok(dict.settings.desktop.systemNotificationSettings);
    assert.ok(dict.settings.mobileNotifications.title);
    assert.ok(dict.settings.mobileNotifications.descAndroid);
    assert.ok(dict.settings.mobileNotifications.descIos);
    assert.ok(dict.settings.mobileNotifications.granted);
    assert.ok(dict.settings.mobileNotifications.denied);
    assert.ok(dict.settings.mobileNotifications.prompt);
    assert.ok(dict.settings.mobileNotifications.enableAction);
    assert.ok(dict.settings.mobileNotifications.openSettingsAction);
  }
});

test("android vpn_strings.xml covers all 5 locales with identical string keys", () => {
  const resRoot = path.resolve(
    import.meta.dirname,
    "../../../plugins/xbond/android/src/main/res",
  );
  const extractNames = (xmlPath: string) =>
    [...fs.readFileSync(xmlPath, "utf8").matchAll(/<string name="([^"]+)">/g)]
      .map((match) => match[1])
      .sort();

  const base = extractNames(path.join(resRoot, "values/vpn_strings.xml"));
  assert.ok(base.includes("notification_revoked"));
  for (const dir of [
    "values-zh-rCN",
    "values-zh-rHK",
    "values-ko",
    "values-fa",
  ]) {
    assert.deepEqual(
      extractNames(path.join(resRoot, dir, "vpn_strings.xml")),
      base,
      `${dir}/vpn_strings.xml keys must match values/vpn_strings.xml`,
    );
  }
});
