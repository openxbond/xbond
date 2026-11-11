import assert from "node:assert/strict";
import { test } from "node:test";

import { formatRate } from "../src/activity.ts";

test("formatRate correctly converts byte rates into readable units", () => {
  assert.equal(formatRate(0), "0 B/s");
  assert.equal(formatRate(-50), "0 B/s");
  assert.equal(formatRate(NaN), "0 B/s");

  assert.equal(formatRate(500), "500.00 B/s");
  assert.equal(formatRate(1024), "1.00 KiB/s");
  assert.equal(formatRate(1048576), "1.00 MiB/s");
  assert.equal(formatRate(1073741824 * 3), "3.00 GiB/s");
});
