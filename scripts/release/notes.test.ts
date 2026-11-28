import assert from "node:assert/strict";
import test from "node:test";

import { extractNotesByLocale, parseCommits, releaseNotes } from "./notes.ts";

const log = [
  "a1\tfeat(mobile): add save and share export for logs",
  "b2\tfix(android): bridge ConnectivityManager interfaces",
  "c3\tperf(core): trim startup work",
  "d4\tchore(release): update release scripts",
  "e5\tdocs: add localized READMEs",
  "f6\tstyle(connect): improve spacing",
  "g7\trefactor(client): split the controller",
  "h8\tfeat!: drop legacy config",
].join("\n");

test("parseCommits reads conventional subjects and keeps non-conventional lines", () => {
  const commits = parseCommits(`${log}\ni9\tquick fix without a type`);
  assert.deepEqual(
    commits.map(({ type, scope, subject, breaking }) => ({
      type,
      scope,
      subject,
      breaking,
    })),
    [
      {
        type: "feat",
        scope: "mobile",
        subject: "add save and share export for logs",
        breaking: false,
      },
      {
        type: "fix",
        scope: "android",
        subject: "bridge ConnectivityManager interfaces",
        breaking: false,
      },
      {
        type: "perf",
        scope: "core",
        subject: "trim startup work",
        breaking: false,
      },
      {
        type: "chore",
        scope: "release",
        subject: "update release scripts",
        breaking: false,
      },
      {
        type: "docs",
        scope: undefined,
        subject: "add localized READMEs",
        breaking: false,
      },
      {
        type: "style",
        scope: "connect",
        subject: "improve spacing",
        breaking: false,
      },
      {
        type: "refactor",
        scope: "client",
        subject: "split the controller",
        breaking: false,
      },
      {
        type: "feat",
        scope: undefined,
        subject: "drop legacy config",
        breaking: true,
      },
      {
        type: "other",
        scope: undefined,
        subject: "quick fix without a type",
        breaking: false,
      },
    ],
  );
});

test("notes group by user impact and hide internal churn", () => {
  const notes = releaseNotes({
    version: "1.0.0",
    candidate: false,
    commits: parseCommits(log),
    previousTag: "v0.9.0",
  });
  assert.match(notes, /^# XBond 1\.0\.0\n/);
  assert.match(
    notes,
    /## 新功能 \/ Features\n\n- add save and share export for logs/,
  );
  assert.match(
    notes,
    /## 改進 \/ Improvements\n\n- trim startup work\n- split the controller/,
  );
  assert.match(
    notes,
    /## 修復 \/ Fixes\n\n- bridge ConnectivityManager interfaces/,
  );
  assert.match(
    notes,
    /## 破壞性變更 \/ Breaking changes\n\n- drop legacy config/,
  );
  assert.match(notes, /## 升級須知 \/ Upgrade notes/);
  assert.match(notes, /Android requires the same signing key/);
  assert.match(
    notes,
    /## 完整變更 \/ Full changelog\n\nhttps:\/\/github\.com\/openxbond\/xbond\/compare\/v0\.9\.0\.\.\.v1\.0\.0/,
  );
  for (const hidden of [
    "update release scripts",
    "localized READMEs",
    "improve spacing",
    "(a1)",
  ])
    assert.ok(!notes.includes(hidden), `notes leaked ${hidden}`);
});

test("localized release notes replace the commit summary", () => {
  const notes = releaseNotes({
    version: "1.1.0",
    candidate: false,
    commits: parseCommits(log),
    previousTag: "v1.0.0",
    notes: [
      { locale: "en-us", body: "- Rebuild the connect page" },
      { locale: "zh-hk", body: "- 重構連線頁\n- 新增日誌級別切換" },
    ],
  });
  assert.match(
    notes,
    /^# XBond 1\.1\.0\n\n## 繁體中文（香港）\n\n- 重構連線頁\n- 新增日誌級別切換\n\n## English\n\n- Rebuild the connect page\n/,
  );
  assert.match(notes, /## 升級須知 \/ Upgrade notes/);
  assert.doesNotMatch(notes, /add save and share export for logs/);
  assert.match(
    notes,
    /https:\/\/github\.com\/openxbond\/xbond\/compare\/v1\.0\.0\.\.\.v1\.1\.0/,
  );
});

test("candidate notes keep the candidate out of the stable channel", () => {
  const notes = releaseNotes({
    version: "1.0.0-rc.1",
    candidate: true,
    commits: parseCommits(log),
  });
  assert.match(notes, /不會進入穩定更新通道/);
  assert.match(notes, /does not enter the stable update channel/);
  assert.doesNotMatch(notes, /Full changelog/);
});

test("a release with only internal commits still explains itself", () => {
  const notes = releaseNotes({
    version: "1.0.1",
    candidate: false,
    commits: parseCommits("a1\tchore: tidy up"),
  });
  assert.match(notes, /本版以內部改進與穩定性修復為主/);
  assert.doesNotMatch(notes, /tidy up/);
});

test("extractNotesByLocale splits localized sections and ignores non-locale headings", () => {
  const combined = releaseNotes({
    version: "1.0.3",
    candidate: false,
    commits: [],
    previousTag: "v1.0.2",
    notes: [
      { locale: "en-us", body: "- Added mirror fallback." },
      { locale: "zh-cn", body: "- 新增镜像回退。" },
      { locale: "zh-hk", body: "- 新增鏡像回退。" },
      { locale: "ko", body: "- 미러 폴백 추가." },
      { locale: "fa", body: "- افزودن آینه جایگزین." },
      { locale: "ru", body: "- Добавлен резерв зеркал." },
    ],
  });
  assert.deepEqual(extractNotesByLocale(combined), {
    "zh-hk": "- 新增鏡像回退。",
    "en-us": "- Added mirror fallback.",
    "zh-cn": "- 新增镜像回退。",
    ko: "- 미러 폴백 추가.",
    fa: "- افزودن آینه جایگزین.",
    ru: "- Добавлен резерв зеркал.",
  });
  assert.deepEqual(extractNotesByLocale("## Features\n\n- Something"), {});
});
