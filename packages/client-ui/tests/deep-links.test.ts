import assert from "node:assert/strict";
import test from "node:test";

import { handleDeepLink } from "../src/platform/deep-links.ts";

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
});
