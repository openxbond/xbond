import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cloudSubscription,
  isAccountManaged,
  type SubscriptionMeta,
} from "../src/localapi.ts";

function xbond(id: string, accountIssuer?: string): SubscriptionMeta {
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

function universal(id: string): SubscriptionMeta {
  return {
    id,
    name: id,
    type: "universal",
    upload: 0,
    download: 0,
    total: 0,
    expire: 0,
    autoUpdate: true,
    updateIntervalHours: 24,
    lastUpdated: 0,
  };
}

test("only account-managed subscriptions count as XBond Cloud", () => {
  assert.equal(
    isAccountManaged(xbond("account", "https://cloud.example")),
    true,
  );
  // 手動粘貼 token 建立的 xbond 訂閱沒有 issuer：歸普通訂閱組。
  assert.equal(isAccountManaged(xbond("token-only")), false);
  assert.equal(isAccountManaged(universal("sub")), false);
  assert.equal(isAccountManaged(null), false);
});

test("the account-bound source wins over manually imported cloud links", () => {
  const imported = xbond("old-import");
  const bound = xbond("account", "https://cloud.example.invalid");
  assert.equal(cloudSubscription([imported, bound]), bound);
});

test("fresh subscription metadata wins over an older account snapshot", () => {
  const snapshot = xbond("account", "https://cloud.example.invalid");
  const ready = { ...snapshot, format: "clash" as const };
  assert.equal(cloudSubscription([universal("other"), ready], snapshot), ready);
  assert.equal(cloudSubscription([], snapshot), snapshot);
});

test("a token-only subscription never represents the cloud profile", () => {
  const tokenOnly = xbond("token-only");
  const snapshot = xbond("account", "https://cloud.example.invalid");
  // 列表裡沒有賬號管理條目時回退到快照本身，而不是手動導入的 xbond 訂閱。
  assert.equal(cloudSubscription([tokenOnly], snapshot), snapshot);
  assert.equal(cloudSubscription([tokenOnly], null), undefined);
});
