import assert from "node:assert/strict";
import test from "node:test";

import { buildIOSFramework, runMobileIOS } from "./mobile.ts";

test("buildIOSFramework reports the macOS requirement on non-darwin hosts", () => {
  if (process.platform !== "darwin") {
    const iosRes = buildIOSFramework("temp/test.xcframework");
    assert.equal(iosRes.ok, false);
    assert.match(iosRes.message, /requires macOS/i);
  }
});

test("runMobileIOS throws informative error on non-darwin platform", () => {
  if (process.platform !== "darwin") {
    assert.throws(() => runMobileIOS(), /requires macOS/i);
  }
});
