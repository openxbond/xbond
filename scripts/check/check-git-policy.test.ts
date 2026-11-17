import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCommitLog,
  validateCommitMessage,
  validatePullRequest,
  validateSubject,
} from "./check-git-policy.ts";

const BOT = "xbond-automation[bot]";

test("accepts conventional subjects with English descriptions", () => {
  assert.deepEqual(
    validateSubject("feat(connect): rebuild the home screen"),
    [],
  );
  assert.deepEqual(
    validateSubject("fix(daemon): reclaim stale registrations"),
    [],
  );
  assert.deepEqual(validateSubject("chore(release): 1.1.0"), []);
  assert.deepEqual(validateSubject("chore(release): 1.1.0 (#12)"), []);
});

test("rejects subjects outside the commit policy", () => {
  assert.match(validateSubject("feat: 新增功能").join("\n"), /English/);
  assert.match(
    validateSubject("feat: add 功能").join("\n"),
    /no Chinese characters/,
  );
  assert.match(
    validateSubject("feature: add feature").join("\n"),
    /not allowed/,
  );
  assert.match(
    validateSubject("feat(unknown): add feature").join("\n"),
    /scope "unknown"/,
  );
  assert.match(validateSubject("fix: fix the bug.").join("\n"), /period/);
  assert.match(
    validateSubject(`chore: ${"a".repeat(100)}`).join("\n"),
    /max 100/,
  );
  assert.match(validateSubject("update docs").join("\n"), /expected/);
});

test("breaking commits need a BREAKING CHANGE body line", () => {
  assert.match(
    validateCommitMessage("feat!: remove legacy settings").join("\n"),
    /BREAKING CHANGE/,
  );
  assert.deepEqual(
    validateCommitMessage(
      "feat!: remove legacy settings\n\nBREAKING CHANGE: sign in again",
    ),
    [],
  );
});

test("commit messages must be written in English", () => {
  assert.match(
    validateCommitMessage("feat: add feature\n\n需要重新登入").join("\n"),
    /body must be written in English/,
  );
});

test("PRs must be opened by the automation bot", () => {
  assert.deepEqual(
    validatePullRequest({
      base: "main",
      head: "feat/connect-rebuild",
      title: "feat(connect): rebuild the home screen",
      actor: BOT,
    }),
    [],
  );
  assert.match(
    validatePullRequest({
      base: "main",
      head: "feat/connect-rebuild",
      title: "feat(connect): rebuild the home screen",
      actor: "hydrz",
    }).join("\n"),
    /must be opened by xbond-automation\[bot\]/,
  );
});

test("PRs into main must match the branch prefix and title", () => {
  assert.deepEqual(
    validatePullRequest({
      base: "main",
      head: "feat/connect-rebuild",
      title: "feat(connect): rebuild the home screen",
      actor: BOT,
    }),
    [],
  );
  assert.match(
    validatePullRequest({
      base: "main",
      head: "fix/connect-rebuild",
      title: "feat(connect): rebuild the home screen",
      actor: BOT,
    }).join("\n"),
    /must match branch prefix/,
  );
  assert.match(
    validatePullRequest({
      base: "main",
      head: "feature/connect-rebuild",
      title: "feat(connect): rebuild the home screen",
      actor: BOT,
    }).join("\n"),
    /allowed type/,
  );
});

test("release prep PRs must come from the versioned release branch with the release title", () => {
  assert.deepEqual(
    validatePullRequest({
      base: "main",
      head: "chore/release-1.1.0",
      title: "chore(release): 1.1.0",
      actor: BOT,
    }),
    [],
  );
  assert.match(
    validatePullRequest({
      base: "main",
      head: "chore/release-1.1.0",
      title: "chore(repo): prepare the 1.1.0 release",
      actor: BOT,
    }).join("\n"),
    /must be titled `chore\(release\): X\.Y\.Z`/,
  );
  assert.deepEqual(
    validatePullRequest({
      base: "main",
      head: "chore/trunk-based-model",
      title: "chore(repo): adopt trunk-based single-branch model",
      actor: BOT,
    }),
    [],
  );
});

test("release blocker fixes are ordinary fix branches into main", () => {
  assert.deepEqual(
    validatePullRequest({
      base: "main",
      head: "fix/release-1.0.1-daemon-registration",
      title: "fix(daemon): reclaim stale registrations",
      actor: BOT,
    }),
    [],
  );
  assert.match(
    validatePullRequest({
      base: "main",
      head: "fix/release-1.0.1-daemon-registration",
      title: "feat(daemon): add a new feature",
      actor: BOT,
    }).join("\n"),
    /must match branch prefix/,
  );
});

test("unsupported base branches are refused", () => {
  assert.match(
    validatePullRequest({
      base: "dev",
      head: "feat/connect-rebuild",
      title: "feat(connect): rebuild the home screen",
      actor: BOT,
    }).join("\n"),
    /unsupported base branch/,
  );
  assert.match(
    validatePullRequest({
      base: "release/1.0",
      head: "feat/connect-rebuild",
      title: "feat(connect): rebuild the home screen",
      actor: BOT,
    }).join("\n"),
    /expected main/,
  );
});

test("commits authored or committed by hydrz are rejected", () => {
  const bot =
    "xbond-automation[bot]\t352439229+xbond-automation[bot]@users.noreply.github.com\txbond-automation[bot]\t352439229+xbond-automation[bot]@users.noreply.github.com\tchore: update policy";
  assert.deepEqual(validateCommitLog(`b2\t${bot}`), []);
  const problems = validateCommitLog(
    [
      "a1\tHydrz D\tn.haoyuan@gmail.com\tGitHub\t<noreply@github.com>\tfeat: add feature",
      `b2\t${bot}`,
    ].join("\n"),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /blocked identity/);
});
