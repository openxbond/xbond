import assert from "node:assert/strict";
import { test } from "node:test";

import { cloudSubscription, type SubscriptionMeta } from "../src/localapi.ts";

function source(id: string, accountIssuer?: string): SubscriptionMeta {
  return {
    id,
    name: id,
    type: "xbond",
    accountIssuer,
    upload: 0,
    download: 0,
    total: 0,
    expire: 0,
    autoUpdate: true,
    updateIntervalHours: 24,
    lastUpdated: 0,
  };
}

test("account source wins over an older manually imported Cloud link", () => {
  const imported = source("old-import");
  const bound = source("account", "https://cloud.example.invalid");
  assert.equal(cloudSubscription([imported, bound]), bound);
});

test("fresh subscription metadata wins over an older account snapshot", () => {
  const snapshot = source("account", "https://cloud.example.invalid");
  const ready = { ...snapshot, format: "clash" as const };
  assert.equal(cloudSubscription([source("other"), ready], snapshot), ready);
  assert.equal(cloudSubscription([], snapshot), snapshot);
});
