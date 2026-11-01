import assert from "node:assert/strict";
import { test } from "node:test";

import {
  InvalidConfigError,
  buildManualConfig,
  parseExtensionConfig,
  parseHostRule,
} from "../src/shared/config.ts";

const valid = {
  configVersion: 1,
  issuanceVersion: "iss-1",
  ingress: { hosts: ["proxy.example.com"], port: 8444, tls: true },
  auth: { method: "basic", username: "xbond", credential: "px-token" },
  rules: [],
  defaultAction: "proxy",
};

test("a valid config parses with defaults applied", () => {
  const config = parseExtensionConfig({
    ...valid,
    rules: undefined,
    label: undefined,
  });
  assert.equal(config.rules.length, 0);
  assert.equal(config.defaultAction, "proxy");
  assert.equal(config.auth.username, "xbond");
  assert.equal(config.label, "");
});

test("unsupported configVersion or auth method is rejected", () => {
  assert.throws(
    () => parseExtensionConfig({ ...valid, configVersion: 2 }),
    InvalidConfigError,
  );
  assert.throws(
    () =>
      parseExtensionConfig({
        ...valid,
        auth: { method: "digest", credential: "x" },
      }),
    InvalidConfigError,
  );
  assert.throws(
    () =>
      parseExtensionConfig({
        ...valid,
        ingress: { hosts: ["h"], port: 1, tls: false },
      }),
    InvalidConfigError,
  );
});

test("ingress hosts must be bare hostnames", () => {
  assert.throws(
    () =>
      parseExtensionConfig({
        ...valid,
        ingress: { hosts: ["https://proxy.example.com"], port: 8444 },
      }),
    InvalidConfigError,
  );
  assert.throws(
    () =>
      parseExtensionConfig({
        ...valid,
        ingress: { hosts: ["proxy.example.com:8444"], port: 8444 },
      }),
    InvalidConfigError,
  );
  assert.throws(
    () =>
      parseExtensionConfig({ ...valid, ingress: { hosts: [], port: 8444 } }),
    InvalidConfigError,
  );
});

test("rule patterns accept exact and leading-* shapes only", () => {
  assert.deepEqual(
    parseHostRule({ pattern: "example.com", action: "proxy" }, 0),
    { pattern: "example.com", action: "proxy" },
  );
  assert.deepEqual(
    parseHostRule({ pattern: "*.example.com", action: "direct" }, 0),
    {
      pattern: "*.example.com",
      action: "direct",
    },
  );
  assert.throws(
    () => parseHostRule({ pattern: "*example.com", action: "proxy" }, 0),
    InvalidConfigError,
  );
  assert.throws(
    () => parseHostRule({ pattern: "a?b.com", action: "proxy" }, 0),
    InvalidConfigError,
  );
  assert.throws(
    () => parseHostRule({ pattern: "10.0.0.0/8", action: "direct" }, 0),
    InvalidConfigError,
  );
  assert.throws(
    () => parseHostRule({ pattern: "example.com:443", action: "direct" }, 0),
    InvalidConfigError,
  );
  assert.throws(
    () => parseHostRule({ pattern: "example.com", action: "reject" }, 0),
    InvalidConfigError,
  );
});

test("manual config builds a parseable single-host config", () => {
  const config = buildManualConfig({
    host: "proxy.local",
    port: 8444,
    credential: "tok",
  });
  assert.equal(config.ingress.hosts[0], "proxy.local");
  assert.equal(config.ingress.port, 8444);
  assert.equal(config.auth.credential, "tok");
  assert.match(config.issuanceVersion, /^manual-/);
});
