import assert from "node:assert/strict";
import test from "node:test";

import EN from "../src/i18n/en_US.ts";
import FA from "../src/i18n/fa.ts";
import KO from "../src/i18n/ko.ts";
import CN from "../src/i18n/zh_CN.ts";
import HK from "../src/i18n/zh_HK.ts";
import { DESKTOP_NAV, MOBILE_NAV, NAV_REDIRECTS } from "../src/nav.ts";

const LOCALES = [
  ["en_US", EN],
  ["zh_CN", CN],
  ["zh_HK", HK],
  ["ko", KO],
  ["fa", FA],
] as const;

test("desktop navigation exposes exactly the five primary destinations", () => {
  assert.deepEqual(
    DESKTOP_NAV.map((item) => item.path),
    ["/connect", "/proxies", "/subscriptions", "/activity", "/settings"],
  );
});

test("mobile bottom bar keeps the four prescribed tabs", () => {
  assert.deepEqual(
    MOBILE_NAV.map((item) => item.path),
    ["/connect", "/proxies", "/activity", "/settings"],
  );
  // 配置 has no mobile tab; it enters from the connect page or settings.
  assert.ok(!MOBILE_NAV.some((item) => item.path === "/subscriptions"));
});

test("pre-NAV-01 top-level routes redirect to their secondary-view homes", () => {
  assert.deepEqual(NAV_REDIRECTS["/connections"], {
    to: "/activity",
    view: "connections",
  });
  assert.deepEqual(NAV_REDIRECTS["/logs"], {
    to: "/activity",
    view: "logs",
  });
  assert.deepEqual(NAV_REDIRECTS["/diagnostics"], {
    to: "/activity",
    view: "diagnostics",
  });
  assert.deepEqual(NAV_REDIRECTS["/rules"], { to: "/proxies", view: "rules" });
});

test("every nav destination carries a localized label in all locales", () => {
  for (const [locale, dict] of LOCALES) {
    for (const { name } of [...DESKTOP_NAV, ...MOBILE_NAV]) {
      const key = {
        Connect: "connect",
        Activity: "activity",
        Proxies: "proxies",
        Subscriptions: "subscriptions",
        Settings: "settings",
      }[name];
      const label = dict.sidebar[key];
      assert.ok(
        typeof label === "string" && label.length > 0,
        `${locale} missing sidebar.${key}`,
      );
    }
  }
});
