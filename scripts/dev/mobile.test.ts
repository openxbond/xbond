import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildIOSFramework,
  isAndroidAARStale,
  runMobileIOS,
} from "./mobile.ts";

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

test("isAndroidAARStale detects missing and outdated AARs while ignoring tests", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xbond-aar-test-"));
  try {
    const aar = path.join(dir, "xbond-mobile.aar");
    const goDir = path.join(dir, "mobile");
    fs.mkdirSync(goDir, { recursive: true });
    const src = path.join(goDir, "service.go");
    const testSrc = path.join(goDir, "service_test.go");
    fs.writeFileSync(src, "package mobile\n");
    fs.writeFileSync(testSrc, "package mobile\n");

    assert.equal(isAndroidAARStale(aar, [goDir]), true);

    fs.writeFileSync(aar, "aar");
    const base = new Date(Date.now() - 10_000);
    const newer = new Date(Date.now() + 10_000);
    fs.utimesSync(src, base, base);
    fs.utimesSync(testSrc, newer, newer);
    assert.equal(isAndroidAARStale(aar, [goDir]), false);

    fs.utimesSync(src, newer, newer);
    assert.equal(isAndroidAARStale(aar, [goDir]), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
