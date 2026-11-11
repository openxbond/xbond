import assert from "node:assert/strict";
import { test } from "node:test";

import { formatUptimeClock } from "../src/helper.ts";

test("formatUptimeClock renders uptime seconds as a HH:MM:SS timer", () => {
  assert.equal(formatUptimeClock(5078), "01:24:38");
  assert.equal(formatUptimeClock(5400), "01:30:00");
  assert.equal(formatUptimeClock(45), "00:00:45");
  assert.equal(formatUptimeClock(90605), "25:10:05");
});

test("formatUptimeClock rejects missing and sub-second uptime", () => {
  assert.equal(formatUptimeClock(undefined), null);
  assert.equal(formatUptimeClock(0), null);
  assert.equal(formatUptimeClock(Number.NaN), null);
});
