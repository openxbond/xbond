import assert from "node:assert/strict";
import test from "node:test";

import {
  checkGomobileInstalled,
  runMobileCheck,
  buildAndroidAAR,
  buildIOSFramework,
} from "./mobile.ts";

test("runMobileCheck executes go vet and test on mobile package successfully", () => {
  const result = runMobileCheck();
  assert.equal(result.ok, true, `mobile check failed: ${result.message}`);
  assert.match(result.message, /passed/i);
});

test("checkGomobileInstalled returns a boolean value", () => {
  const isInstalled = checkGomobileInstalled();
  assert.equal(typeof isInstalled, "boolean");
});

test("build functions return graceful error when gomobile is not available or path is invalid", () => {
  // If gomobile is not in PATH, should return ok: false with informative message
  if (!checkGomobileInstalled()) {
    const androidRes = buildAndroidAAR("temp/test.aar");
    assert.equal(androidRes.ok, false);
    assert.match(androidRes.message, /gomobile is not installed/i);

    const iosRes = buildIOSFramework("temp/test.xcframework");
    assert.equal(iosRes.ok, false);
    assert.match(iosRes.message, /gomobile is not installed/i);
  }
});
