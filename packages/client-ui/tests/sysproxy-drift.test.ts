import assert from "node:assert/strict";
import test from "node:test";

import type { SystemProxyDrift } from "@xbond/client/localapi";

import { sysproxyDriftView } from "../src/features/connect/sysproxy-drift.ts";

// 差異界面只為「已接管且被外部改動」存在：健康、他人設定與讀不到狀態的
// 未知都不能偽裝成漂移，也不能把漂移吞成正常（意圖與事實分開展示）。
test("sysproxyDriftView derives a view only for a drifted owned takeover", () => {
  const drift = (
    reasonCode: SystemProxyDrift["reasonCode"],
    overrides: Partial<SystemProxyDrift> = {},
  ): SystemProxyDrift => ({
    intent: true,
    owned: true,
    known: true,
    drifted: true,
    reasonCode,
    ...overrides,
  });

  for (const reasonCode of [
    "external_off",
    "external_override",
    "read_error",
  ] as const) {
    const view = sysproxyDriftView(drift(reasonCode));
    assert.deepEqual(view, {
      reason: reasonCode,
      messageKey: `sysproxyDrift.${reasonCode}`,
    });
  }

  assert.equal(
    sysproxyDriftView(drift(undefined, { drifted: false })),
    null,
    "a healthy owned takeover renders no drift surface",
  );
  assert.equal(
    sysproxyDriftView(
      drift(undefined, { drifted: false, owned: false, intent: true }),
    ),
    null,
    "intent without ownership is the pre-connect state, not drift",
  );
  assert.equal(sysproxyDriftView(undefined), null);
});
