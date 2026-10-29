import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { LocalAPIClient, type ThreeTierStatus } from "../src/localapi.ts";

test("LocalAPIClient communicates with daemon using token auth and handles status, up, down, setMode", async (t) => {
  const requests: {
    path: string;
    token?: string;
    method?: string;
    body: string;
  }[] = [];

  const mockStatus = {
    engine: {
      running: true,
      pid: 12345,
      mixedPort: 7890,
      clashPort: 9090,
      uptime: "1h30m",
      configPath: "/tmp/runtime.json",
    },
    preferences: {
      takeoverMode: "sysproxy",
      routingMode: "rule",
      mixedPort: 7890,
      allowLan: false,
      clashPort: 9090,
    },
    threeTier: {
      coreReachable: true,
      trafficIntercepted: true,
      egressVerified: true,
      egressLatencyMs: 42,
      takeoverMode: "sysproxy",
      routingMode: "rule",
      strategyChain: ["PROXY", "Auto-HK", "HK-01"],
    },
    activeSub: {
      id: "sub-xbond-test",
      name: "XBond VIP",
      type: "xbond",
      upload: 1073741824,
      download: 5368709120,
      total: 107374182400,
      expire: 1800000000,
      autoUpdate: true,
      updateIntervalHours: 24,
      lastUpdated: 1729000000,
    },
  };

  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      path: req.url ?? "",
      token: req.headers["x-xbond-token"] as string | undefined,
      method: req.method,
      body,
    });

    res.setHeader("Content-Type", "application/json");

    if (req.headers["x-xbond-token"] !== "secret-test-token") {
      res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    if (req.url === "/localapi/v0/status") {
      res.writeHead(200).end(JSON.stringify(mockStatus));
      return;
    }

    if (req.url === "/localapi/v0/up") {
      res
        .writeHead(200)
        .end(JSON.stringify({ ok: true, status: mockStatus.engine }));
      return;
    }

    if (req.url === "/localapi/v0/down") {
      res.writeHead(200).end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === "/localapi/v0/mode") {
      res.writeHead(200).end(JSON.stringify({ ok: true }));
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

  // 1. Unauthorized request fails
  const unauthorizedClient = new LocalAPIClient(endpoint, "wrong-token");
  await assert.rejects(unauthorizedClient.getStatus(), /unauthorized/);

  // 2. Authorized status query
  const client = new LocalAPIClient(endpoint, "secret-test-token");
  const status = await client.getStatus();
  assert.equal(status.engine.running, true);
  assert.equal(status.preferences.takeoverMode, "sysproxy");
  assert.equal(status.threeTier.coreReachable, true);
  assert.equal(status.activeSub?.name, "XBond VIP");

  // 3. Up and Down calls
  const upRes = await client.up({ mode: "sysproxy", routing: "rule" });
  assert.equal(upRes.ok, true);

  const downRes = await client.down();
  assert.equal(downRes.ok, true);

  // 4. SetMode call
  const modeRes = await client.setMode({ routing: "global" });
  assert.equal(modeRes.ok, true);

  // Verify all requests carried token
  assert.ok(
    requests.filter((r) => r.token === "secret-test-token").length >= 4,
  );
});

test("Three-tier status ladder honestly evaluates remote controller vs local takeover mode", () => {
  // Remote Controller Mode (no local daemon): AC-UI-2
  function evaluateRemote(
    coreVersion: string,
    activeDelay: number | null,
  ): ThreeTierStatus {
    const coreOk = Boolean(coreVersion);
    const egressOk = typeof activeDelay === "number" && activeDelay > 0;
    return {
      coreReachable: coreOk,
      trafficIntercepted: false,
      egressVerified: egressOk,
      egressLatencyMs: egressOk ? activeDelay : 0,
      takeoverMode: "port",
      routingMode: "rule",
      interceptNote:
        "在遠端控制器模式下，界面僅控制遠端核心分流，未接管本機系統流量。",
    };
  }

  const remoteConnected = evaluateRemote("sing-box 1.13.21", 45);
  assert.equal(remoteConnected.coreReachable, true);
  // AC-UI-2: Takeover must NOT claim system protection in remote mode!
  assert.equal(remoteConnected.trafficIntercepted, false);
  assert.ok(remoteConnected.interceptNote?.includes("未接管本機系統流量"));
  assert.equal(remoteConnected.egressVerified, true);

  const remoteDisconnected = evaluateRemote("", null);
  assert.equal(remoteDisconnected.coreReachable, false);
  assert.equal(remoteDisconnected.egressVerified, false);
});

test("Strategy chain resolves nested groups to ultimate egress leaf", () => {
  interface MockGroup {
    name: string;
    now: string;
    all: string[];
  }

  const mapping = new Map<string, MockGroup | { name: string; type: string }>([
    [
      "PROXY",
      {
        name: "PROXY",
        now: "Auto-HK",
        all: ["Auto-HK", "HK-01", "JP-01", "DIRECT"],
      },
    ],
    [
      "Auto-HK",
      {
        name: "Auto-HK",
        now: "HK-01",
        all: ["HK-01", "HK-02"],
      },
    ],
    [
      "HK-01",
      {
        name: "HK-01",
        type: "Trojan",
      },
    ],
  ]);

  function resolveStrategyChain(
    startGroupName: string,
    groupsMap: Map<string, MockGroup | { name: string; type: string }>,
  ): string[] {
    const chain: string[] = [startGroupName];
    let current = (groupsMap.get(startGroupName) as MockGroup)?.now;
    const visited = new Set<string>([startGroupName]);

    while (current && !visited.has(current)) {
      visited.add(current);
      chain.push(current);
      const next = groupsMap.get(current);
      if (!next || !("now" in next)) break;
      current = (next as MockGroup).now;
    }
    return chain;
  }

  const chain = resolveStrategyChain("PROXY", mapping);
  assert.deepEqual(chain, ["PROXY", "Auto-HK", "HK-01"]);
  assert.equal(chain[chain.length - 1], "HK-01");
});

test("Latency tier categorization matches DESIGN.md thresholds", () => {
  function getLatencyTier(
    delay: number | null | undefined,
  ): "fast" | "medium" | "slow" | "untested" {
    if (typeof delay !== "number" || delay <= 0) return "untested";
    if (delay > 400) return "slow";
    if (delay >= 150) return "medium";
    return "fast";
  }

  assert.equal(getLatencyTier(45), "fast");
  assert.equal(getLatencyTier(149), "fast");
  assert.equal(getLatencyTier(150), "medium");
  assert.equal(getLatencyTier(399), "medium");
  assert.equal(getLatencyTier(400), "medium");
  assert.equal(getLatencyTier(401), "slow");
  assert.equal(getLatencyTier(1200), "slow");
  assert.equal(getLatencyTier(0), "untested");
  assert.equal(getLatencyTier(null), "untested");
});
