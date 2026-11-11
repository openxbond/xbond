import assert from "node:assert/strict";
import test from "node:test";

import { classifyConnectError } from "../src/features/connect/connect-error.ts";

test("android vpn consent is its own class ahead of the generic fallback", () => {
  assert.equal(
    classifyConnectError("VPN consent required").kind,
    "vpn_consent",
  );
});

test("bind failures keep the port-conflict class", () => {
  assert.equal(
    classifyConnectError("Address already in use (os error 98)").kind,
    "port_conflict",
  );
  assert.equal(
    classifyConnectError("failed to bind: 127.0.0.1:7890").kind,
    "port_conflict",
  );
});

test("the daemon capability gate keeps the tun-denied class", () => {
  assert.equal(
    classifyConnectError("TUN takeover unavailable: install the service").kind,
    "tun_denied",
  );
});

test("everything else stays generic", () => {
  assert.equal(
    classifyConnectError("core exited unexpectedly").kind,
    "generic",
  );
});
