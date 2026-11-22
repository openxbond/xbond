import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { LocalAPIClient } from "../src/localapi.ts";

test("account notification sync and read endpoints send expected payloads", async (t) => {
  const requests: { path: string; method: string; body: string }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({
      path: request.url ?? "",
      method: request.method ?? "",
      body,
    });
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/localapi/v0/account/notifications/read-all") {
      response.end(
        JSON.stringify({
          status: "signed_in",
          announcements: [],
          personal: [],
        }),
      );
      return;
    }
    response.end(
      JSON.stringify({
        status: "signed_in",
        unreadCount: 1,
        announcements: [
          {
            id: "ann-1",
            title: "Maintenance",
            content: "Body",
            category: "maintenance",
            isBanner: true,
          },
        ],
        personal: [
          {
            id: "per-1",
            kind: "referral_reward",
            data: { amountCents: 500, currency: "USD" },
            createdAt: "2026-11-22T00:00:00Z",
          },
        ],
      }),
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
    "test-token",
  );

  const synced = await client.accountSync({ lang: "zh-HK" });
  assert.equal(synced.unreadCount, 1);
  assert.equal(synced.announcements?.[0]?.content, "Body");
  assert.equal(synced.personal?.[0]?.kind, "referral_reward");

  await client.markAnnouncementRead("ann-1");
  await client.markPersonalNotificationRead("per-1");
  const cleared = await client.markAllNotificationsRead();
  assert.equal(cleared.unreadCount, 0);

  assert.deepEqual(
    requests.map((entry) => ({
      path: entry.path,
      method: entry.method,
      body: entry.body ? JSON.parse(entry.body) : null,
    })),
    [
      {
        path: "/localapi/v0/account/sync",
        method: "POST",
        body: { lang: "zh-HK" },
      },
      {
        path: "/localapi/v0/account/notifications/read",
        method: "POST",
        body: { announcementId: "ann-1" },
      },
      {
        path: "/localapi/v0/account/notifications/read",
        method: "POST",
        body: { personalId: "per-1" },
      },
      {
        path: "/localapi/v0/account/notifications/read-all",
        method: "POST",
        body: null,
      },
    ],
  );
});
