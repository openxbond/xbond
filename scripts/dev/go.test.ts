import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.deepEqual(targeted.args.slice(3), [
    "./internal/sub",
    "-run",
    "TestUpdate",
  ]);
  assert.deepEqual(goCommand("test", ["-run", "TestUpdate"]).args.slice(3), [
    "./...",
    "-run",
    "TestUpdate",
  ]);
});

test("the Dockerfile builds with the shared build tags", () => {
  const dockerfile = readFileSync(
    new URL("../../Dockerfile", import.meta.url),
    "utf8",
  );
  assert.ok(
    dockerfile.includes(`ARG BUILD_TAGS=${BUILD_TAGS}`),
    "Dockerfile must default BUILD_TAGS to scripts/dev/go.ts's value",
  );
  assert.ok(
    dockerfile.includes("-tags ${BUILD_TAGS}"),
    "the daemon build must consume the BUILD_TAGS arg",
  );
});
