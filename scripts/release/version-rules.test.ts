import assert from "node:assert/strict";
import test from "node:test";

import { releaseVersion } from "./release-version.ts";
import { MAX_BUILD, releaseProblems } from "./version-rules.ts";

test("stable and candidate tags satisfy the bundle version rules", () => {
  assert.deepEqual(releaseProblems("v1.0.0"), []);
  assert.deepEqual(releaseProblems("v1.0.0-rc.1"), []);
  assert.deepEqual(releaseProblems("v99.99.99-rc.98"), []);
});

test("candidates take a slot below the stable build of the same base", () => {
  const candidate = releaseVersion("v1.0.0-rc.98");
  const stable = releaseVersion("v1.0.0");
  assert.ok(candidate.build < stable.build);
  assert.equal(candidate.build % 100, 98);
  assert.equal(stable.build % 100, 99);
  assert.ok(stable.build <= MAX_BUILD);
  assert.equal(releaseVersion("v99.99.99").build, MAX_BUILD);
});
