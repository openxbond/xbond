import assert from "node:assert/strict";
import test from "node:test";

import {
  releasePolicyProblems,
  releaseVariableProblems,
} from "./release-config.ts";

const updaterPublicKey = Buffer.concat([
  Buffer.from("Ed"),
  Buffer.alloc(40, 42),
]).toString("base64");
const variables = {
  XBOND_RELEASE_PUBLIC_KEY: Buffer.alloc(32, 42).toString("base64"),
  XBOND_TAURI_PUBLIC_KEY: Buffer.from(
    `untrusted comment: test public key\n${updaterPublicKey}\n`,
  ).toString("base64"),
  ANDROID_KEY_ALIAS: "test",
  ANDROID_SIGNER_SHA256: "ab".repeat(32),
};

test("release configuration distinguishes rehearsal and Apple signing", () => {
  assert.deepEqual(releaseVariableProblems(variables, false), []);
  assert.deepEqual(releaseVariableProblems(variables, true), [
    "Missing APPLE_TEAM_ID.",
    "Missing APPLE_SIGNING_IDENTITY.",
  ]);
});

test("release preflight rejects double-encoded updater keys and colon-separated digests", () => {
  const problems = releaseVariableProblems(
    {
      ...variables,
      XBOND_TAURI_PUBLIC_KEY: Buffer.from(
        variables.XBOND_TAURI_PUBLIC_KEY,
      ).toString("base64"),
      ANDROID_SIGNER_SHA256: Array(32).fill("ab").join(":"),
    },
    false,
  );
  assert.equal(problems.length, 2);
  assert.match(problems[0], /XBOND_TAURI_PUBLIC_KEY/);
  assert.match(problems[1], /ANDROID_SIGNER_SHA256/);
});

test("deployment policies must be typed: tag pushes are rejected by branch-only rules", () => {
  const signing = [
    { name: "main", type: "branch" },
    { name: "v*", type: "tag" },
  ];
  const live = {
    "release-manifest-signing": signing,
    "release-desktop-signing": signing,
    "release-android-signing": signing,
    "release-ios-signing": signing,
    "release-store-ios": signing,
    "release-production": [{ name: "main", type: "branch" }],
    "github-pages": [{ name: "main", type: "branch" }],
  };
  assert.deepEqual(releasePolicyProblems(live), []);
  const branchOnly = {
    ...live,
    "release-ios-signing": [{ name: "main", type: "branch" }],
  };
  assert.match(
    releasePolicyProblems(branchOnly).join("\n"),
    /release-ios-signing.*main:branch, v\*:tag/,
  );
  const untypedTag = {
    ...live,
    "release-android-signing": [
      { name: "main", type: "branch" },
      { name: "v*", type: "branch" },
    ],
  };
  assert.match(
    releasePolicyProblems(untypedTag).join("\n"),
    /release-android-signing/,
  );
  const missing: Partial<typeof live> = { ...live };
  delete missing["release-manifest-signing"];
  assert.match(
    releasePolicyProblems(missing).join("\n"),
    /missing or has no typed deployment policies/,
  );
});
