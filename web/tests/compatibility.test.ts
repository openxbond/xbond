import assert from "node:assert/strict";
import { test } from "node:test";

import { coreCapabilities } from "../src/lib/capabilities.ts";
import { ConnectionStore } from "../src/lib/connection-store.ts";
import {
  controllerFromQuery,
  migrateControllers,
  normalizeControllerURL,
  streamURL,
  validPort,
  createControllerId,
} from "../src/lib/controller.ts";
import { runLatencyTests, validLatencyOptions } from "../src/lib/latency.ts";
import type { Connections } from "../src/lib/request.ts";

const fallback = {
  id: "default",
  name: "",
  url: "http://127.0.0.1:9090",
  secret: "",
};
test("HTTP LAN deployments generate profile IDs without secure-context randomUUID", (t) => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis.crypto,
    "randomUUID",
  );
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: undefined,
    configurable: true,
  });
  t.after(() => {
    if (original)
      Object.defineProperty(globalThis.crypto, "randomUUID", original);
    else Reflect.deleteProperty(globalThis.crypto, "randomUUID");
  });
  assert.notEqual(createControllerId(), createControllerId());
  const hosts = migrateControllers(
    [
      { hostname: "192.168.1.1", port: 9090, secret: "one" },
      { hostname: "192.168.1.2", port: 9090, secret: "two" },
    ],
    fallback,
  );
  assert.equal(hosts.length, 2);
  assert.equal(hosts[0].secret, "one");
});
test("controller migration preserves multiple profiles and repairs invalid records", () => {
  const hosts = migrateControllers(
    [
      { hostname: "localhost", port: 9090, secret: "one" },
      { hostname: "::1", port: 9091, secret: "two" },
      { url: "file:///secret" },
    ],
    fallback,
  );
  assert.equal(hosts.length, 2);
  assert.notEqual(hosts[0].id, hosts[1].id);
  assert.equal(hosts[1].url, "http://[::1]:9091");
  assert.equal(hosts[0].secret, "one");
  assert.deepEqual(migrateControllers(null, fallback), [fallback]);
});
test("HTTPS launch parameters and reverse proxy paths survive REST/WS URL construction", () => {
  const controller = controllerFromQuery(
    "?protocol=https:&host=example.com&port=9443&secret=a%26b",
    fallback,
  );
  assert.equal(controller.url, "https://example.com:9443");
  assert.equal(controller.secret, "a&b");
  const ws = new URL(
    streamURL("https://example.com/core", "logs?level=debug", "a&b"),
  );
  assert.equal(ws.protocol, "wss:");
  assert.equal(ws.pathname, "/core/logs");
  assert.equal(ws.searchParams.get("level"), "debug");
  assert.equal(ws.searchParams.get("token"), "a&b");
  assert.throws(() => normalizeControllerURL("javascript:alert(1)"));
  assert.throws(() =>
    normalizeControllerURL("https://user:password@example.com"),
  );
});
test("sing-box compatibility flags do not advertise Clash Premium mutations", () => {
  const sing = coreCapabilities(
    { version: "sing-box 1.14.2", premium: true, meta: true },
    ["Rule", "Work"],
  );
  assert.deepEqual(sing.modes, ["Rule", "Work"]);
  assert.equal(sing.editPorts, false);
  assert.equal(sing.editLan, false);
  assert.equal(sing.reloadConfig, false);
  assert.equal(sing.proxyProviders, false);
  assert.equal(sing.ruleProviders, false);
  assert.equal(sing.flushCache, true);
  assert.equal(
    coreCapabilities({
      version: "sing-box 1.14.2",
      premium: true,
    }).modes.includes("script"),
    false,
  );
  assert.equal(coreCapabilities({ version: "v1.18.0" }).editPorts, true);
  assert.equal(coreCapabilities({ version: "v1.18.0" }).ruleProviders, false);
});
test("listener ports and latency options reject empty, fractional and out-of-range input", () => {
  for (const value of ["", "-1", "1.2", "65536", "NaN"])
    assert.equal(validPort(value), false);
  assert.equal(validPort(0), true);
  assert.equal(validPort(65535), true);
  assert.equal(validLatencyOptions("http://example.com", 5000), false);
  assert.equal(validLatencyOptions("https://example.com", 5000), true);
  assert.equal(validLatencyOptions("https://example.com", 50000), false);
});
function connection(id: string, upload = 0, download = 0): Connections {
  return {
    id,
    upload,
    download,
    start: "2026-01-01T00:00:00Z",
    chains: [],
    rule: "",
    rulePayload: "",
    metadata: {
      network: "tcp",
      type: "http",
      host: "example.com",
      sourceIP: "127.0.0.1",
      sourcePort: "1234",
      destinationPort: "443",
    },
  };
}
test("connection speed uses elapsed time and resets after disconnection or counter reset", () => {
  const store = new ConnectionStore();
  store.appendToSet([connection("one", 100, 200)], 1000);
  store.appendToSet([connection("one", 1100, 2200)], 3000);
  assert.equal(store.getConnections()[0].uploadSpeed, 500);
  assert.equal(store.getConnections()[0].downloadSpeed, 1000);
  store.resetRate();
  store.appendToSet([connection("one", 1200, 2400)], 8000);
  assert.equal(store.getConnections()[0].uploadSpeed, 0);
  store.appendToSet([connection("one", 0, 0)], 9000);
  assert.equal(store.getConnections()[0].uploadSpeed, 0);
  store.appendToSet(null, 10000);
  assert.deepEqual(store.getConnections(), []);
});
test("closed connection retention is bounded by count and age", () => {
  const store = new ConnectionStore();
  store.toggleSave();
  store.appendToSet(
    Array.from({ length: 1100 }, (_, index) => connection(String(index))),
    0,
  );
  store.appendToSet([], 1000);
  assert.equal(store.getConnections().length, 1000);
  store.appendToSet([], 1801000);
  assert.equal(store.getConnections().length, 0);
});
test("latency queue deduplicates nodes, limits concurrency and stops dispatching after cancellation", async () => {
  const controller = new AbortController();
  let active = 0,
    maximum = 0,
    completed = 0;
  await runLatencyTests(
    ["a", "a", "b", "c", "d", "e"],
    async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      completed++;
      active--;
    },
    controller.signal,
    2,
  );
  assert.equal(maximum, 2);
  assert.equal(completed, 5);
  const canceled = new AbortController();
  let dispatched = 0;
  await runLatencyTests(
    ["a", "b", "c"],
    async () => {
      dispatched++;
      canceled.abort();
    },
    canceled.signal,
    1,
  );
  assert.equal(dispatched, 1);
});
