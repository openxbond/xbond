import assert from "node:assert/strict";
import { test } from "node:test";

import { parseExtensionConfig } from "../src/shared/config.ts";
import {
  assertPacContainsNoCredential,
  generatePacSource,
} from "../src/shared/pac.ts";

const credential = "px-0123456789abcdef0123456789abcdef0123456789abcdef";

const baseConfig = parseExtensionConfig({
  configVersion: 1,
  issuanceVersion: "test-1",
  ingress: { hosts: ["proxy.example.com"], port: 8444, tls: true },
  auth: { method: "basic", username: "xbond", credential },
  rules: [
    { pattern: "corp.example.net", action: "direct" },
    { pattern: "*.split.io", action: "proxy" },
  ],
  defaultAction: "proxy",
});

test("global mode generates a single-egress PAC without rules", () => {
  const source = generatePacSource(baseConfig, "global");
  assert.match(source, /function FindProxyForURL/);
  assert.match(source, /HTTPS proxy\.example\.com:8444/);
  assert.ok(
    !source.includes("corp.example.net"),
    "global PAC must not embed rules",
  );
});

test("rules mode expands exact and suffix rules over the default action", () => {
  const source = generatePacSource(baseConfig, "rules");
  assert.match(source, /h === "corp\.example\.net"\) return "DIRECT"/);
  assert.match(
    source,
    /h === "split\.io" \|\| h\.endsWith\("\.split\.io"\)\) return "HTTPS proxy\.example\.com:8444"/,
  );
  assert.match(
    source,
    /return "HTTPS proxy\.example\.com:8444";\s*}$/m,
    "default action closes the PAC",
  );
});

test("default direct keeps the fallback on DIRECT", () => {
  const config = parseExtensionConfig({
    ...baseConfig,
    rules: [{ pattern: "a.b", action: "proxy" }],
    defaultAction: "direct",
  });
  const source = generatePacSource(config, "rules");
  assert.match(source, /return "DIRECT";\s*}$/m);
});

test("PAC source never contains the credential or auth headers", () => {
  const source = generatePacSource(baseConfig, "rules");
  assert.ok(!source.includes(credential));
  assert.doesNotThrow(() => assertPacContainsNoCredential(source, credential));
});

test("credential guard fails loudly on leakage", () => {
  assert.throws(() =>
    assertPacContainsNoCredential(`return "${credential}"`, credential),
  );
  assert.throws(() =>
    assertPacContainsNoCredential(
      "Proxy-Authorization: Basic dXNlcjpwYXNz",
      credential,
    ),
  );
});
