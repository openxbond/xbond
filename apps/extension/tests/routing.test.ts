import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import type { ExtensionConfig } from "../src/shared/extension-config.ts";
import { generatePacSource } from "../src/shared/pac.ts";
import { generateGlobalPacSource } from "../src/shared/pac.ts";
import {
  globalExceptions,
  withOverrides,
  normalizeDomain,
  predictRoute,
  predictGlobalRoute,
} from "../src/shared/routing.ts";

const config: ExtensionConfig = {
  version: 1,
  proxyToken: "px-" + "ab".repeat(24),
  nodes: [
    {
      name: "Tokyo",
      server: "edge.example.org",
      port: 443,
      password: "aa".repeat(16),
    },
  ],
  groups: [{ name: "Default", type: "select", members: ["Tokyo", "DIRECT"] }],
  rules: [
    { kind: "domain-suffix", suffixes: ["example.org"], target: "Default" },
  ],
  ruleSets: {},
  final: "Default",
};

test("website exceptions normalize IDNs, reject URLs and cannot silently use a missing target", () => {
  assert.equal(normalizeDomain("BÜCHER.example."), "xn--bcher-kva.example");
  assert.throws(() => normalizeDomain("https://example.org/path"));
  assert.throws(() => normalizeDomain("example.org:443"));
  assert.throws(() =>
    withOverrides(config, [
      {
        id: "bad",
        domain: "example.org",
        match: "exact",
        target: "missing",
        enabled: true,
      },
    ]),
  );
});

test("exact exceptions precede longest suffix exceptions and PAC agrees with route prediction", () => {
  const overrides = [
    {
      id: "all",
      domain: "example.org",
      match: "suffix" as const,
      target: "REJECT",
      enabled: true,
    },
    {
      id: "docs",
      domain: "docs.example.org",
      match: "suffix" as const,
      target: "DIRECT",
      enabled: true,
    },
    {
      id: "exact",
      domain: "api.docs.example.org",
      match: "exact" as const,
      target: "Tokyo",
      enabled: true,
    },
  ];
  const compiled = withOverrides(config, overrides);
  for (const [host, target] of [
    ["www.example.org", "REJECT"],
    ["docs.example.org", "DIRECT"],
    ["api.docs.example.org", "Tokyo"],
    ["other.example.net", "Tokyo"],
  ]) {
    const prediction = predictRoute(compiled, {}, host);
    assert.equal(prediction.path.at(-1), target);
    const pac = generatePacSource(compiled, {});
    const actual = runInNewContext(
      pac + `;FindProxyForURL("https://${host}/", "${host}")`,
      { isInNet: () => false },
    );
    assert.equal(actual, prediction.action);
  }
  assert.equal(predictRoute(compiled, {}, "notexample.org").source, "final");
});

test("disabled exceptions stay editable but do not override cloud rules", () => {
  const compiled = withOverrides(config, [
    {
      id: "off",
      domain: "example.org",
      match: "exact",
      target: "REJECT",
      enabled: false,
    },
  ]);
  assert.equal(predictRoute(compiled, {}, "example.org").path.at(-1), "Tokyo");
});

test("global mode honours website exceptions and the PAC agrees with prediction", () => {
  const overrides = [
    {
      id: "all",
      domain: "example.org",
      match: "suffix" as const,
      target: "REJECT",
      enabled: true,
    },
    {
      id: "docs",
      domain: "docs.example.org",
      match: "suffix" as const,
      target: "DIRECT",
      enabled: true,
    },
    {
      id: "exact",
      domain: "api.docs.example.org",
      match: "exact" as const,
      target: "Tokyo",
      enabled: true,
    },
  ];
  const pac = generateGlobalPacSource(
    config,
    {},
    [],
    undefined,
    globalExceptions(config, overrides, {}),
  );
  for (const [host, target] of [
    ["www.example.org", "REJECT"],
    ["docs.example.org", "DIRECT"],
    ["api.docs.example.org", "Tokyo"],
    ["other.example.net", "Tokyo"], // miss → primary exit (Default group)
  ]) {
    const prediction = predictGlobalRoute(
      config,
      {},
      overrides,
      undefined,
      host,
    );
    assert.equal(prediction.path.at(-1), target);
    const actual = runInNewContext(
      pac + `;FindProxyForURL("https://${host}/", "${host}")`,
      {},
    );
    assert.equal(actual, prediction.action);
  }
});

test("disabled exceptions do not apply in global mode either", () => {
  const prediction = predictGlobalRoute(
    config,
    {},
    [
      {
        id: "off",
        domain: "example.org",
        match: "exact",
        target: "REJECT",
        enabled: false,
      },
    ],
    undefined,
    "example.org",
  );
  assert.equal(prediction.path.at(-1), "Tokyo");
});
