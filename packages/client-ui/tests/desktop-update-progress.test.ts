import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDownloadProgress,
  selectLocalizedReleaseNote,
} from "../src/features/settings/update-progress.ts";

test("formatDownloadProgress returns null label and percent before bytes arrive", () => {
  assert.deepEqual(formatDownloadProgress(0, null), {
    percent: null,
    label: null,
  });
  assert.deepEqual(formatDownloadProgress(undefined, undefined), {
    percent: null,
    label: null,
  });
});

test("formatDownloadProgress formats received bytes when total is unknown", () => {
  const result = formatDownloadProgress(1024 * 1024, null);
  assert.equal(result.percent, null);
  assert.equal(result.label, "1.00 MiB");
});

test("formatDownloadProgress formats determinate progress with clamped percentage", () => {
  const halfway = formatDownloadProgress(5 * 1024 * 1024, 10 * 1024 * 1024);
  assert.equal(halfway.percent, 50);
  assert.equal(halfway.label, "5.00 MiB / 10.00 MiB (50%)");

  const overflow = formatDownloadProgress(12 * 1024 * 1024, 10 * 1024 * 1024);
  assert.equal(overflow.percent, 100);
  assert.equal(overflow.label, "10.00 MiB / 10.00 MiB (100%)");
});

test("selectLocalizedReleaseNote picks matching locale and falls back to en-us", () => {
  const notes = {
    "en-us": "- English changes",
    "zh-cn": "- 简体中文更新",
    "zh-hk": "- 繁體中文更新",
  };
  assert.equal(selectLocalizedReleaseNote(notes, "zh-CN"), "- 简体中文更新");
  assert.equal(selectLocalizedReleaseNote(notes, "zh-HK"), "- 繁體中文更新");
  assert.equal(selectLocalizedReleaseNote(notes, "zh-TW"), "- 繁體中文更新");
  assert.equal(selectLocalizedReleaseNote(notes, "ko"), "- English changes");
  assert.equal(selectLocalizedReleaseNote(undefined, "zh-CN"), null);
});
