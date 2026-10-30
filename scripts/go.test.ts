import assert from "node:assert/strict";
import test from "node:test";

import { BUILD_TAGS, goCommand } from "./go.ts";

test("every go invocation carries the shared build tags", () => {
  for (const command of ["build", "run", "test", "vet"]) {
    const { args } = goCommand(command);
    const at = args.indexOf("-tags");
    assert.notEqual(at, -1, `${command} is missing -tags`);
    assert.equal(args[at + 1], BUILD_TAGS);
  }
});

test("gofmt walks every Go package tree", () => {
  for (const command of ["fmt", "fmt:check"]) {
    const { args } = goCommand(command);
    for (const dir of ["cmd", "internal", "mobile"]) {
      assert.ok(args.includes(dir), `${command} skips ${dir}`);
    }
  }
});

test("extra args append after the fixed form", () => {
  const run = goCommand("run", ["--version"]);
  assert.equal(run.args.at(-1), "--version");
  const targeted = goCommand("test", ["./internal/sub", "-run", "TestUpdate"]);
  assert.ok(targeted.args.includes("./internal/sub"));
  assert.ok(targeted.args.includes("-run"));
});
