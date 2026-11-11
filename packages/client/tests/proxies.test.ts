import assert from "node:assert/strict";
import { test } from "node:test";

import { compareDesc, delayToneClass } from "../src/latency.ts";
import type { Proxy } from "../src/request.ts";

test("delayToneClass strictly enforces DESIGN.md latency color tiers", () => {
  // Untested or non-positive
  assert.equal(delayToneClass(0), "bg-muted text-muted-foreground");
  assert.equal(delayToneClass(-1), "bg-muted text-muted-foreground");

  // Tier 1: < 150ms green (success)
  assert.equal(delayToneClass(45), "bg-success text-success-foreground");
  assert.equal(delayToneClass(149), "bg-success text-success-foreground");

  // Tier 2: 150ms - 400ms amber (warning)
  assert.equal(delayToneClass(150), "bg-warning text-warning-foreground");
  assert.equal(delayToneClass(280), "bg-warning text-warning-foreground");
  assert.equal(delayToneClass(400), "bg-warning text-warning-foreground");

  // Tier 3: > 400ms coral red (destructive)
  assert.equal(
    delayToneClass(401),
    "bg-destructive text-destructive-foreground",
  );
  assert.equal(
    delayToneClass(999),
    "bg-destructive text-destructive-foreground",
  );
});

test("compareDesc dynamically accounts for live latency test results over stale history", () => {
  const nodeA: Proxy = {
    name: "Node-A",
    type: "Trojan",
    udp: true,
    history: [{ time: "2026-10-27T10:00:00Z", delay: 200 }],
  };

  const nodeB: Proxy = {
    name: "Node-B",
    type: "Trojan",
    udp: true,
    history: [{ time: "2026-10-27T10:00:00Z", delay: 100 }],
  };

  // Without live results: B (100ms) has lower latency than A (200ms)
  // In compareDesc: (delayB - delayA) -> positive means A before B in descending delay
  assert.ok(compareDesc(nodeA, nodeB) < 0); // nodeB (100) < nodeA (200)

  // With live results: Node-A got tested at 50ms, Node-B timed out / 600ms
  const liveResults = {
    "Node-A": { delay: 50, status: "ok" },
    "Node-B": { delay: 600, status: "ok" },
  };

  // Now Node-B (600ms) has higher latency than Node-A (50ms)
  assert.ok(compareDesc(nodeA, nodeB, liveResults) > 0);
});

test("compareDesc handles dead or unreachable nodes by assigning max penalty", () => {
  const aliveNode: Proxy = {
    name: "Alive",
    type: "Trojan",
    udp: true,
    alive: true,
    history: [{ time: "2026-10-27T10:00:00Z", delay: 80 }],
  };

  const deadNode: Proxy = {
    name: "Dead",
    type: "Trojan",
    udp: true,
    alive: false,
    history: [{ time: "2026-10-27T10:00:00Z", delay: 80 }],
  };

  // Dead node gets treated as delay 0 (or Max Safe Integer penalty, sorting after alive nodes)
  assert.ok(compareDesc(aliveNode, deadNode) > 0);
});
