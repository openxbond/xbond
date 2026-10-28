import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { LocalAPIClient } from "../src/lib/localapi.ts";

test("daemon quota and RFC3339 timestamps normalize consistently across status and subscription operations", async (t) => {
  const subscription = {
    id: "profile",
    name: "Example",
    type: "universal",
    autoUpdate: true,
    updateIntervalHours: 24,
    quota: {
      uploadBytes: 5,
      downloadBytes: 15,
      totalBytes: 100,
      expireUnix: 1800000000,
    },
    lastUpdatedAt: "2026-10-28T00:00:00Z",
  };
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.url?.endsWith("/status")
          ? { activeSub: subscription }
          : req.url?.endsWith("/update")
            ? { ok: true, diff: {}, meta: subscription }
            : req.url?.endsWith("/login")
              ? subscription
              : { activeId: "profile", subscriptions: [subscription] },
      ),
    );
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
    "fixture",
  );
  for (const meta of [
    (await client.getStatus()).activeSub,
    (await client.listSubs()).subscriptions[0],
    (await client.updateSub()).meta,
    await client.addSub({ urlOrFile: "https://example.invalid" }),
  ]) {
    assert.ok(meta);
    assert.equal(meta.upload + meta.download, 20);
    assert.equal(meta.total, 100);
    assert.equal(meta.expire, 1800000000);
    assert.equal(
      meta.lastUpdated,
      Date.parse(subscription.lastUpdatedAt) / 1000,
    );
  }
});
