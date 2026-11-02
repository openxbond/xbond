import assert from "node:assert/strict";
import { test } from "node:test";

import { formatUptimeClock } from "../src/helper.ts";

test("formatUptimeClock renders Go duration strings as a HH:MM:SS timer", () => {
  assert.equal(formatUptimeClock("1h24m38.5s"), "01:24:38");
  assert.equal(formatUptimeClock("1h30m"), "01:30:00");
  assert.equal(formatUptimeClock("45s"), "00:00:45");
  assert.equal(formatUptimeClock("25h10m5s"), "25:10:05");
});

test("formatUptimeClock rejects empty, sub-second and unparseable uptime", () => {
  assert.equal(formatUptimeClock(undefined), null);
  assert.equal(formatUptimeClock(""), null);
  assert.equal(formatUptimeClock("0s"), null);
  assert.equal(formatUptimeClock("not-a-duration"), null);
});
