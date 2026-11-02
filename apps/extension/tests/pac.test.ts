import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseExtensionConfig,
  parseUserInfo,
  type ExtensionConfig,
} from "../src/shared/extension-config.ts";
import {
  assertPacContainsNoCredentials,
  compileEntries,
  generateGlobalPacSource,
  generatePacSource,
} from "../src/shared/pac.ts";
import { ResolveError, resolveLeaf } from "../src/shared/workspace.ts";

const NODE_A = {
  name: "🇭🇰 香港 01",
  server: "hk-edge.example.com",
  port: 443,
  password: "aabbccddeeff00112233445566778899aabbccdd",
};
const NODE_B = {
  name: "🇵🇭 菲律宾 01",
  server: "ph-edge.example.com",
  port: 443,
  password: "1234567890ab00112233445566778899aabbccdd",
};

const CONFIG: ExtensionConfig = parseExtensionConfig({
  version: 1,
  proxyToken: "px-" + "11".repeat(24),
  nodes: [NODE_A, NODE_B],
  groups: [
    {
      name: "🚀 节点选择",
      type: "select",
      members: [
        "⚡ 自动选择",
        "🇭🇰 香港 01",
        "🇵🇭 菲律宾 01",
        "DIRECT",
        "REJECT",
      ],
    },
    {
      name: "⚡ 自动选择",
      type: "urltest",
      members: ["🇭🇰 香港 01", "🇵🇭 菲律宾 01"],
    },
    {
      name: "🌀 AI 服务",
      type: "select",
      members: ["🇵🇭 菲律宾 01", "🚀 节点选择"],
    },
    { name: "🎯 国内直连", type: "select", members: ["DIRECT", "🚀 节点选择"] },
  ],
  rules: [
    { kind: "ruleset", id: "OpenAI", target: "🌀 AI 服务" },
    { kind: "ruleset", id: "ChinaDomains", target: "🎯 国内直连" },
    {
      kind: "domain-suffix",
      suffixes: ["custom.example"],
      target: "🚀 节点选择",
    },
  ],
  ruleSets: {
    OpenAI: [
      {
        domain: ["api.openai.com"],
        domain_suffix: ["openai.com", "chatgpt.com"],
        domain_keyword: ["openai"],
      },
    ],
    ChinaDomains: [
      { domain_suffix: ["cn.example"] },
      { ip_cidr: ["10.0.0.0/8", "fd00::/8"] },
    ],
  },
  final: "🚀 节点选择",
});

const PRIMARY_SELECTION = { "🚀 节点选择": "🇭🇰 香港 01" };

test("resolveLeaf follows groups, defaults and built-ins with a cycle guard", () => {
  assert.deepEqual(resolveLeaf(CONFIG, {}, "🚀 节点选择"), {
    kind: "node",
    node: NODE_A,
  });
  assert.deepEqual(
    resolveLeaf(CONFIG, { "🚀 节点选择": "DIRECT" }, "🚀 节点选择"),
    {
      kind: "direct",
    },
  );
  assert.deepEqual(resolveLeaf(CONFIG, {}, "REJECT"), { kind: "reject" });
  assert.deepEqual(resolveLeaf(CONFIG, {}, "🇵🇭 菲律宾 01"), {
    kind: "node",
    node: NODE_B,
  });

  const cyclic = parseExtensionConfig({
    ...CONFIG,
    groups: [
      { name: "A", type: "select", members: ["B"] },
      { name: "B", type: "select", members: ["A"] },
    ],
    rules: [],
    ruleSets: {},
    final: "A",
  });
  assert.throws(() => resolveLeaf(cyclic, {}, "A"), ResolveError);
});

test("compileEntries expands rulesets in order with first-match priorities", () => {
  const entries = compileEntries(CONFIG, PRIMARY_SELECTION);
  const suffixEntries = entries.filter(
    (entry) => entry.kind === "domain-suffix",
  );
  const suffixes = suffixEntries.map((entry) => entry.suffix);
  assert.ok(suffixes.includes("openai.com"));
  assert.ok(suffixes.includes("cn.example"));
  assert.ok(suffixes.includes("custom.example"));
  const openai = suffixEntries.find((entry) => entry.suffix === "openai.com");
  const china = suffixEntries.find((entry) => entry.suffix === "cn.example");
  assert.ok(openai && china && openai.priority < china.priority);
  // 出口按组解析：AI 服务缺省首个成员 = 菲律宾节点 → 密码前缀子域。
  assert.equal(
    openai.action,
    `HTTPS ${NODE_B.password.slice(0, 12)}.${NODE_B.server}:443`,
  );
  // 国内直连缺省 DIRECT。
  assert.equal(china.action, "DIRECT");
});

test("rule PAC carries the O(1) index, the fallback and no credentials", () => {
  const source = generatePacSource(CONFIG, PRIMARY_SELECTION);
  assert.match(source, /function FindProxyForURL/);
  assert.match(source, /var EXACT = /);
  assert.match(source, /var SUFFIX = /);
  assert.match(source, /var KEYWORDS = /);
  assert.match(source, /var CIDRS = /);
  const expectedFallback = `"HTTPS ${NODE_A.password.slice(0, 12)}.hk-edge.example.com:443"`;
  assert.ok(
    source.includes(`: ${expectedFallback};`),
    "fallback resolves the primary selection",
  );
  assert.doesNotThrow(() => assertPacContainsNoCredentials(source, CONFIG));
  assert.ok(!source.includes(CONFIG.proxyToken));
  assert.ok(
    !source.includes(NODE_A.password),
    "full node password must not enter the PAC",
  );
});

test("global PAC pins the primary selection", () => {
  const source = generateGlobalPacSource(CONFIG, {
    "🚀 节点选择": "🇵🇭 菲律宾 01",
  });
  assert.ok(
    source.includes(
      `"HTTPS ${NODE_B.password.slice(0, 12)}.ph-edge.example.com:443"`,
    ),
  );
});

test("PAC drops IPv6 cidrs (not expressible) and keeps IPv4 isInNet", () => {
  const source = generatePacSource(CONFIG, PRIMARY_SELECTION);
  const cidrs = /var CIDRS = (\[[^;]*\]);/.exec(source)?.[1] ?? "";
  assert.match(cidrs, /10\.0\.0\.0/);
  assert.ok(!cidrs.includes("fd00::"), "IPv6 CIDRs cannot be expressed in PAC");
});

test("credential guard fails loudly on leakage", () => {
  const source =
    generatePacSource(CONFIG, PRIMARY_SELECTION) + CONFIG.proxyToken;
  assert.throws(() => assertPacContainsNoCredentials(source, CONFIG));
});

test("subscription-userinfo parsing", () => {
  const quota = parseUserInfo(
    "upload=0; download=125829120; total=536870912000; expire=1893456000",
  );
  assert.deepEqual(quota, {
    uploadBytes: 0,
    downloadBytes: 125829120,
    totalBytes: 536870912000,
    expiresAt: 1893456000,
  });
  assert.equal(parseUserInfo(null), null);
  assert.equal(parseUserInfo("bogus"), null);
});

test("config validation rejects unknown shapes", () => {
  assert.throws(() => parseExtensionConfig({ ...CONFIG, version: 2 }));
  assert.throws(() =>
    parseExtensionConfig({ ...CONFIG, proxyToken: "not-a-token" }),
  );
  assert.throws(() =>
    parseExtensionConfig({
      ...CONFIG,
      nodes: [{ name: "n", server: "s", port: 0, password: "aabbccdd" }],
    }),
  );
  assert.throws(() => parseExtensionConfig({ ...CONFIG, final: "" }));
});
