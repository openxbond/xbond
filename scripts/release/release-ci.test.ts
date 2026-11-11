import assert from "node:assert/strict";
import test from "node:test";

import { releaseSettings } from "./release-ci.ts";

test("a tag push always prepares a signed release", () => {
  assert.deepEqual(releaseSettings("push", "rehearsal"), {
    mode: "release",
    appleSigning: true,
  });
});

test("manual prepare selects signing and promotion mode explicitly", () => {
  for (const [input, mode, appleSigning] of [
    ["rehearsal", "rehearsal", false],
    ["rehearsal-with-apple", "rehearsal", true],
    ["release", "release", true],
  ] as const) {
    assert.deepEqual(releaseSettings("workflow_dispatch", input), {
      mode,
      appleSigning,
    });
  }
  assert.throws(
    () => releaseSettings("workflow_dispatch", ""),
    /Expected release/,
  );
});
