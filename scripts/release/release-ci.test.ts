import assert from "node:assert/strict";
import test from "node:test";

import {
  missingNoteLocales,
  normalizePlatforms,
  releasePlatforms,
  releaseSettings,
} from "./release-ci.ts";

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

test("platform subsets keep core and reject unknown families", () => {
  assert.equal(normalizePlatforms(undefined), releasePlatforms.join(","));
  assert.equal(normalizePlatforms("all"), releasePlatforms.join(","));
  assert.equal(normalizePlatforms("android"), "core,android");
  assert.equal(normalizePlatforms("android,image"), "core,android,image");
  assert.throws(() => normalizePlatforms("nightly"), /Unknown platform/);
});

test("real tags require all six release note locales", () => {
  assert.deepEqual(missingNoteLocales(undefined), [
    "zh-hk",
    "en-us",
    "zh-cn",
    "ko",
    "fa",
    "ru",
  ]);
  assert.deepEqual(missingNoteLocales([{ locale: "zh-hk" }]), [
    "en-us",
    "zh-cn",
    "ko",
    "fa",
    "ru",
  ]);
  assert.deepEqual(
    missingNoteLocales([
      { locale: "zh-hk" },
      { locale: "en-us" },
      { locale: "zh-cn" },
      { locale: "ko" },
      { locale: "fa" },
      { locale: "ru" },
    ]),
    [],
  );
});
