import assert from "node:assert/strict";
import test from "node:test";

import { parsePackageBadging, parseSignerDigest } from "./release-android.ts";

const apksignerCerts = `Signer #1 certificate DN: CN=XBond
Signer #1 certificate SHA-256 digest: abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789
Signer #2 certificate SHA-256 digest: 1111111111111111111111111111111111111111111111111111111111111111`;

test("parseSignerDigest reads the first signer certificate digest", () => {
  assert.equal(
    parseSignerDigest(apksignerCerts),
    "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  );
  assert.equal(parseSignerDigest("no certificates here"), undefined);
});

test("parsePackageBadging reads the application identity", () => {
  assert.deepEqual(
    parsePackageBadging(
      "package: name='net.xbond.app' versionCode='40300' versionName='0.4.3'\nlaunchable-activity: name='net.xbond.app.MainActivity'",
    ),
    { name: "net.xbond.app", versionCode: "40300", versionName: "0.4.3" },
  );
  assert.equal(parsePackageBadging("sdkVersion:'34'"), undefined);
});
