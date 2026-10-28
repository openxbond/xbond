import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { Client } from "../src/lib/request.ts";

test("client preserves reverse proxy prefix, encodes names, authenticates and supports cancellation", async (t) => {
  const requests: {
    path: string;
    auth?: string;
    method?: string;
    body: string;
  }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({
      path: request.url ?? "",
      auth: request.headers.authorization,
      method: request.method,
      body,
    });
    response.setHeader("Content-Type", "application/json");
    if (request.url?.startsWith("/controller/providers/proxies")) {
      response.writeHead(404).end("{}");
      return;
    }
    response.end(
      JSON.stringify(
        request.url?.includes("/delay?")
          ? { delay: 42 }
          : { version: "sing-box 1.14.2" },
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
  const client = new Client(
    `http://127.0.0.1:${address.port}/controller`,
    "test-only-secret",
  );
  assert.equal((await client.getVersion()).data.version, "sing-box 1.14.2");
  assert.equal(
    (await client.getProxyDelay("node / 中文", "https://example.com/204", 3000))
      .data.delay,
    42,
  );
  const delay = new URL(requests[1].path, "http://test");
  assert.equal(
    decodeURIComponent(delay.pathname),
    "/controller/proxies/node / 中文/delay",
  );
  assert.equal(delay.searchParams.get("url"), "https://example.com/204");
  assert.equal(delay.searchParams.get("timeout"), "3000");
  assert.ok(
    requests.every((request) => request.auth === "Bearer test-only-secret"),
  );
  assert.deepEqual((await client.getProxyProviders()).data.providers, {});
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    client.getProxyDelay(
      "node",
      "https://example.com",
      5000,
      controller.signal,
    ),
    { code: "ERR_CANCELED" },
  );
});
