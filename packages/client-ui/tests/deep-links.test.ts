import assert from "node:assert/strict";
import test from "node:test";

import {
  accountCallbackFromDeepLink,
  handleDeepLink,
} from "../src/platform/deep-links.ts";

function navigateTarget(raw: string): string | undefined {
  let to: string | undefined;
  handleDeepLink(raw, (dest) => {
    to = dest;
  });
  return to;
}

test("import deep links land on the import form with the payload URL", () => {
  assert.equal(
    navigateTarget(
      "xbond://install-config?url=https%3A%2F%2Fexample.com%2Fsub",
    ),
    "/config?item=add-profile&url=https%3A%2F%2Fexample.com%2Fsub",
  );
  // clash compatibility scheme, unencoded payload
  assert.equal(
    navigateTarget("clash://install-config?url=https://example.com/sub"),
    "/config?item=add-profile&url=https%3A%2F%2Fexample.com%2Fsub",
  );
  // sing-box compatibility scheme; extra params (name) are ignored
  assert.equal(
    navigateTarget(
      "sing-box://import-remote-profile?url=https%3A%2F%2Fexample.com%2Fsub&name=node",
    ),
    "/config?item=add-profile&url=https%3A%2F%2Fexample.com%2Fsub",
  );
});

test("import deep links without a payload URL are ignored", () => {
  assert.equal(navigateTarget("xbond://install-config"), undefined);
  assert.equal(navigateTarget("sing-box://import-remote-profile"), undefined);
});

test("foreign schemes and garbage links are ignored", () => {
  assert.equal(navigateTarget("https://example.com/sub"), undefined);
  assert.equal(navigateTarget("not a url"), undefined);
  assert.equal(
    handleDeepLink(undefined, () => {}),
    false,
  );
  assert.equal(
    handleDeepLink(42, () => {}),
    false,
  );
});

test("navigate and route actions jump to in-app routes", () => {
  assert.equal(navigateTarget("xbond://navigate?to=%2Fproxies"), "/proxies");
  assert.equal(navigateTarget("clash://route?to=/settings"), "/settings");
  // path-form routes keep working without URL.hostname
  assert.equal(navigateTarget("xbond://navigate/proxies"), "/proxies");
});

test("account callback extracts code and state from the deep link", () => {
  assert.deepEqual(
    accountCallbackFromDeepLink("xbond://callback?code=abc&state=st"),
    {
      code: "abc",
      state: "st",
    },
  );
  // a trailing slash must not disqualify the landing
  assert.deepEqual(
    accountCallbackFromDeepLink("xbond://callback/?code=abc&state=st"),
    {
      code: "abc",
      state: "st",
    },
  );
  // percent-encoded params decode
  assert.deepEqual(
    accountCallbackFromDeepLink("xbond://callback?state=s%20t&code=a%2Bb"),
    {
      code: "a+b",
      state: "s t",
    },
  );
});

test("account callback rejects foreign routes and missing params", () => {
  // strict route match: extra segments must not masquerade as the landing
  assert.equal(
    accountCallbackFromDeepLink("xbond://callback/extra?code=a&state=b"),
    null,
  );
  assert.equal(accountCallbackFromDeepLink("xbond://callback"), null);
  assert.equal(accountCallbackFromDeepLink("xbond://callback?code=abc"), null);
  assert.equal(accountCallbackFromDeepLink("xbond://callback?state=st"), null);
  assert.equal(
    accountCallbackFromDeepLink("https://callback?code=a&state=b"),
    null,
  );
  assert.equal(
    accountCallbackFromDeepLink("clash://callback?code=a&state=b"),
    null,
  );
});

test("deep link actions parse without URL.hostname", () => {
  // Chromium below ~126 parses `xbond://callback?…` as an opaque path:
  // URL.hostname comes back empty on those WebViews, so the action segment
  // must be read from the raw link. These raw forms must behave the same on
  // engines on both sides of that parser change.
  assert.deepEqual(
    accountCallbackFromDeepLink("xbond://callback?code=a&state=b"),
    {
      code: "a",
      state: "b",
    },
  );
  assert.equal(navigateTarget("xbond://navigate?to=/settings"), "/settings");
  assert.equal(
    navigateTarget("clash://install-config?url=https://example.com/sub"),
    "/config?item=add-profile&url=https%3A%2F%2Fexample.com%2Fsub",
  );
});
