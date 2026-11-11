import assert from "node:assert/strict";
import type { SpawnSyncReturns } from "node:child_process";
import test from "node:test";

import { run } from "./transfer.ts";

function fakeResult(
  status: number,
  stdout: string,
  stderr: string,
): SpawnSyncReturns<string> {
  return {
    pid: 1,
    output: ["", stdout, stderr],
    stdout,
    stderr,
    status,
    signal: null,
  };
}

test("transient connection failure is retried", () => {
  const responses = [
    fakeResult(128, "", "Recv failure: Connection was reset"),
    fakeResult(0, "commit-sha\n", ""),
  ];
  let calls = 0;
  const output = run("git", ["ls-remote", "origin"], {
    spawnImpl: (() =>
      responses[
        calls++
      ]!) as unknown as typeof import("node:child_process").spawnSync,
    sleepImpl: () => {},
  });
  assert.equal(output, "commit-sha");
  assert.equal(calls, 2);
});

test("permission failure is not retried", () => {
  let calls = 0;
  assert.throws(
    () =>
      run("git", ["push", "origin"], {
        spawnImpl: (() => {
          calls++;
          return fakeResult(128, "", "Permission denied");
        }) as unknown as typeof import("node:child_process").spawnSync,
        sleepImpl: () => {},
      }),
    /Command failed/,
  );
  assert.equal(calls, 1);
});
