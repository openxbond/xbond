import assert from "node:assert/strict";
import test from "node:test";

import { deriveAppleSigning, deriveReleaseMode } from "./release-ci.ts";

test("tag pushes always prepare a release", () => {
  assert.equal(deriveReleaseMode("push", ""), "release");
  assert.equal(deriveReleaseMode("push", "true"), "release");
});

test("dispatch rehearses only when the rehearsal input is set", () => {
  assert.equal(deriveReleaseMode("workflow_dispatch", "true"), "rehearsal");
  assert.equal(deriveReleaseMode("workflow_dispatch", "false"), "release");
  assert.equal(deriveReleaseMode("workflow_dispatch", ""), "release");
});

test("Apple signing covers pushes, full preparations and opted-in rehearsals", () => {
  assert.equal(deriveAppleSigning("push", "release", ""), true);
  assert.equal(deriveAppleSigning("workflow_dispatch", "release", ""), true);
  assert.equal(
    deriveAppleSigning("workflow_dispatch", "rehearsal", "true"),
    true,
  );
});

test("rehearsals without Apple credentials skip the signed archive", () => {
  assert.equal(deriveAppleSigning("workflow_dispatch", "rehearsal", ""), false);
  assert.equal(
    deriveAppleSigning("workflow_dispatch", "rehearsal", "false"),
    false,
  );
});
