import assert from "node:assert/strict";
import test from "node:test";

import { releaseVariableProblems } from "./release-config.ts";

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
