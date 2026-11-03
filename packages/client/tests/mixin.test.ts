import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { LocalAPIClient, type GlobalMixin } from "../src/localapi.ts";

test("LocalAPIClient reads and updates global mixin", async (t) => {
  let storedMixin: GlobalMixin = {
    bypassLan: true,
    rulesPrepend: ["DOMAIN,test.example,DIRECT"],
  };

  const server = createServer(async (req, res) => {
    assert.equal(req.headers["x-xbond-token"], "test-token");
    if (req.url === "/localapi/v0/mixins/global") {
      if (req.method === "GET") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(storedMixin));
        return;
      }
      if (req.method === "PUT") {
        let body = "";
        for await (const chunk of req) body += chunk;
        storedMixin = JSON.parse(body);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, mixin: storedMixin }));
        return;
      }
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

  const initial = await client.getGlobalMixin();
  assert.equal(initial.bypassLan, true);
  assert.deepEqual(initial.rulesPrepend, ["DOMAIN,test.example,DIRECT"]);

  const updated = await client.setGlobalMixin({
    bypassLan: false,
    rulesPrepend: ["DOMAIN,new.example,DIRECT"],
    dns: "nameserver:\n  - 1.1.1.1\n",
  });
  assert.equal(updated.ok, true);
  assert.equal(storedMixin.bypassLan, false);
  assert.equal(storedMixin.dns, "nameserver:\n  - 1.1.1.1\n");
});
