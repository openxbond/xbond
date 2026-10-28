import assert from "node:assert/strict";
import { test } from "node:test";

import { subscriptionQuota } from "../src/lib/localapi.ts";

test("subscription quota distinguishes unknown data from exhausted and unused quota", () => {
  assert.equal(subscriptionQuota(null), null);
  for (const total of [0, -1, Infinity, NaN])
    assert.equal(subscriptionQuota({ upload: 0, download: 0, total }), null);
  assert.equal(
    subscriptionQuota({ upload: -1, download: 10, total: 100 }),
    null,
  );
  assert.equal(
    subscriptionQuota({ upload: 0, download: NaN, total: 100 }),
    null,
  );
  assert.deepEqual(subscriptionQuota({ upload: 0, download: 0, total: 100 }), {
    used: 0,
    remaining: 100,
    remainingPercent: 100,
  });
  assert.deepEqual(subscriptionQuota({ upload: 5, download: 20, total: 100 }), {
    used: 25,
    remaining: 75,
    remainingPercent: 75,
  });
  assert.deepEqual(
    subscriptionQuota({ upload: 20, download: 80, total: 100 }),
    { used: 100, remaining: 0, remainingPercent: 0 },
  );
  assert.deepEqual(
    subscriptionQuota({ upload: 30, download: 90, total: 100 }),
    { used: 120, remaining: 0, remainingPercent: 0 },
  );
});
