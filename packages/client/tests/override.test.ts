import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  LocalAPIClient,
  type SubscriptionOverride,
  type SubscriptionPolicies,
} from "../src/localapi.ts";

test("LocalAPIClient reads and writes a subscription override", async (t) => {
  let stored: SubscriptionOverride = {
    groups: [
      { name: "Corp", target: "DIRECT", enabled: true, rules: ["example.com"] },
    ],
    dns: { nameservers: ["223.5.5.5"] },
  };

  const server = createServer(async (req, res) => {
    assert.equal(req.headers["x-xbond-token"], "test-token");
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/localapi/v0/subs/override") {
      if (req.method === "GET") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(stored));
        return;
      }
      if (req.method === "PUT") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body);
        assert.equal(payload.id, "sub-1");
        stored = { groups: payload.groups, dns: payload.dns };
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
        return;
      }
    }
    if (url.pathname === "/localapi/v0/subs/policies" && req.method === "GET") {
      assert.equal(url.searchParams.get("id"), "sub-1");
      const payload: SubscriptionPolicies = {
        id: "sub-1",
        format: "clash",
        policies: ["Proxy", "DIRECT", "REJECT"],
      };
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(payload));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = new LocalAPIClient(
    `http://127.0.0.1:${address.port}`,
    "test-token",
  );

  const initial = await client.getSubOverride("sub-1");
  assert.equal(initial.groups?.[0]?.target, "DIRECT");
  assert.deepEqual(initial.dns?.nameservers, ["223.5.5.5"]);

  const updated = await client.setSubOverride("sub-1", {
    groups: [
      {
        name: "Ads",
        target: "REJECT",
        enabled: true,
        rules: ["ads.example", "10.0.0.0/8"],
      },
    ],
    dns: { nameservers: ["1.1.1.1"], fallback: ["8.8.8.8"] },
  });
  assert.equal(updated.ok, true);
  assert.equal(stored.groups?.[0]?.name, "Ads");
  assert.deepEqual(stored.groups?.[0]?.rules, ["ads.example", "10.0.0.0/8"]);
  assert.deepEqual(stored.dns?.nameservers, ["1.1.1.1"]);
  assert.deepEqual(stored.dns?.fallback, ["8.8.8.8"]);

  const available = await client.getSubPolicies("sub-1");
  assert.equal(available.format, "clash");
  assert.deepEqual(available.policies, ["Proxy", "DIRECT", "REJECT"]);
});
