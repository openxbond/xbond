import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import {
  detectLocalAPIConfig,
  LocalAPIClient,
  type SubscriptionMeta,
} from "../src/lib/localapi.ts";

test("Capability Sensing correctly identifies presence vs absence of LocalAPI", () => {
  // 1. Without DOM / meta tags: returns null (remote web controller mode)
  const configAbsent = detectLocalAPIConfig();
  assert.equal(configAbsent, null);
});

test("Dual-track subscription management (XBond Cloud token vs Universal URL) with update and delete", async (t) => {
  const subs: SubscriptionMeta[] = [
    {
      id: "sub-xbond-1",
      name: "XBond Pro",
      type: "xbond",
      token: "sub-secret-token",
      upload: 500000,
      download: 25000000,
      total: 500000000,
      expire: 1800000000,
      autoUpdate: true,
      updateIntervalHours: 24,
      lastUpdated: 1729000000,
    },
  ];
  let activeId = "sub-xbond-1";

  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.setHeader("Content-Type", "application/json");

    if (req.url === "/localapi/v0/subs" && req.method === "GET") {
      res.writeHead(200).end(JSON.stringify({ subscriptions: subs, activeId }));
      return;
    }

    if (req.url === "/localapi/v0/login" && req.method === "POST") {
      const parsed = JSON.parse(body);
      const isXBond = Boolean(parsed.token);
      const newSub: SubscriptionMeta = {
        id: isXBond ? "sub-xbond-new" : "sub-universal-new",
        name: parsed.name || (isXBond ? "XBond Cloud" : "Universal"),
        type: isXBond ? "xbond" : "universal",
        token: parsed.token,
        urlOrFile: parsed.urlOrFile,
        upload: 0,
        download: 0,
        total: isXBond ? 1000000000 : 0,
        expire: 0,
        autoUpdate: true,
        updateIntervalHours: 24,
        lastUpdated: Math.floor(Date.now() / 1000),
      };
      subs.push(newSub);
      activeId = newSub.id;
      res.writeHead(200).end(JSON.stringify(newSub));
      return;
    }

    if (req.url === "/localapi/v0/subs/use" && req.method === "POST") {
      const parsed = JSON.parse(body);
      activeId = parsed.id;
      res.writeHead(200).end(JSON.stringify({ ok: true, activeId }));
      return;
    }

    if (req.url === "/localapi/v0/subs/update" && req.method === "POST") {
      res.writeHead(200).end(
        JSON.stringify({
          ok: true,
          contentChanged: true,
          diff: { added: ["HK-02"], removed: ["HK-old"] },
        }),
      );
      return;
    }

    if (
      req.url?.startsWith("/localapi/v0/subs?id=") &&
      req.method === "DELETE"
    ) {
      const id = new URL(req.url, "http://127.0.0.1").searchParams.get("id");
      const idx = subs.findIndex((s) => s.id === id);
      if (idx !== -1) subs.splice(idx, 1);
      res.writeHead(200).end(JSON.stringify({ ok: true, deleted: id }));
      return;
    }

    res.writeHead(404).end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const client = new LocalAPIClient(endpoint, "test-token");

  // 1. List initial subscriptions
  const initial = await client.listSubs();
  assert.equal(initial.subscriptions.length, 1);
  assert.equal(initial.activeId, "sub-xbond-1");

  // 2. Add Track A: XBond Cloud Token
  const addedXBond = await client.addSub({
    token: "sub-user-token-123",
    name: "My XBond VIP",
    protocol: "trojan",
  });
  assert.equal(addedXBond.type, "xbond");
  assert.equal(addedXBond.name, "My XBond VIP");

  // 3. Add Track B: Universal Subscription URL
  const addedUniversal = await client.addSub({
    urlOrFile: "https://example.com/clash.yaml",
    name: "Custom Node List",
  });
  assert.equal(addedUniversal.type, "universal");
  assert.equal(addedUniversal.name, "Custom Node List");

  // 4. Verify list now has 3
  const afterAdd = await client.listSubs();
  assert.equal(afterAdd.subscriptions.length, 3);

  // 5. Switch active subscription
  await client.useSub("sub-xbond-1");
  const afterUse = await client.listSubs();
  assert.equal(afterUse.activeId, "sub-xbond-1");

  // 6. Update subscription and inspect diff
  const updateRes = await client.updateSub("sub-xbond-1");
  assert.equal(updateRes.ok, true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const diff = updateRes.diff as any;
  assert.deepEqual(diff.added, ["HK-02"]);
  assert.deepEqual(diff.removed, ["HK-old"]);

  // 7. Remove subscription
  await client.removeSub("sub-universal-new");
  const afterRemove = await client.listSubs();
  assert.equal(afterRemove.subscriptions.length, 2);
});

test("Local takeover mode switching, doctor, and bugreport queries", async (t) => {
  let currentMode = "sysproxy";
  let mixedPort = 7890;

  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.setHeader("Content-Type", "application/json");

    if (req.url === "/localapi/v0/mode" && req.method === "POST") {
      const parsed = JSON.parse(body);
      if (parsed.mode) currentMode = parsed.mode;
      if (parsed.port) mixedPort = parsed.port;
      res
        .writeHead(200)
        .end(JSON.stringify({ ok: true, currentMode, mixedPort }));
      return;
    }

    if (req.url === "/localapi/v0/doctor") {
      res.writeHead(200).end(
        JSON.stringify({
          timestamp: "2026-10-27T12:00:00Z",
          engineRunning: true,
          checks: [
            { name: "Port 7890", ok: true, detail: "Listening" },
            { name: "Sysproxy", ok: true, detail: "Enabled 127.0.0.1:7890" },
          ],
        }),
      );
      return;
    }

    if (req.url === "/localapi/v0/bugreport") {
      res.writeHead(200).end(
        JSON.stringify({
          version: "0.1.0",
          singBoxVersion: "1.13.21",
          preferences: { takeoverMode: currentMode, mixedPort },
        }),
      );
      return;
    }

    res.writeHead(404).end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const client = new LocalAPIClient(endpoint, "test-token");

  // 1. Switch to tun mode
  await client.setMode({ mode: "tun", port: 7895 });
  assert.equal(currentMode, "tun");
  assert.equal(mixedPort, 7895);

  // 2. Run Doctor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doctor = (await client.runDoctor()) as any;
  assert.equal(doctor.engineRunning, true);
  assert.equal(doctor.checks.length, 2);

  // 3. Export Bug Report
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bugreport = (await client.getBugReport()) as any;
  assert.equal(bugreport.version, "0.1.0");
  assert.equal(bugreport.preferences.takeoverMode, "tun");
});
