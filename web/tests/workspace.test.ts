import assert from "node:assert/strict";
import { test } from "node:test";

import type { Group } from "../src/lib/request.ts";
import {
  focusedGroup,
  strategyPath,
  workspaceLink,
  controllerIdentity,
  isDaemonController,
} from "../src/lib/workspace.ts";

test("local capability belongs only to the daemon controller and focus identity excludes credentials", () => {
  assert.equal(isDaemonController("http://127.0.0.1:9090", 9090), true);
  assert.equal(isDaemonController("http://remote.example:9090", 9090), false);
  assert.equal(isDaemonController("http://127.0.0.1:9091", 9090), false);
  assert.equal(isDaemonController("http://127.0.0.1:9090"), false);
  const identity = controllerIdentity(
    "profile",
    "https://name:secret@core.example/prefix?token=hidden",
  );
  assert.equal(identity.includes("secret"), false);
  assert.equal(identity.includes("hidden"), false);
  assert.equal(
    identity,
    controllerIdentity("profile", "https://core.example/prefix"),
  );
});

const group = (name: string, now = "node"): Group => ({
  name,
  now,
  type: "Selector",
  all: [now],
  history: [],
});

test("multiple policy groups require an explicit focus and stale selections stay unresolved", () => {
  const groups = [group("stream"), group("default")];
  assert.equal(focusedGroup(groups), null);
  assert.equal(focusedGroup(groups, "missing"), null);
  assert.equal(focusedGroup(groups, "default")?.name, "default");
  assert.equal(focusedGroup([groups[0]])?.name, "stream");
});

test("nested strategy paths terminate on a leaf and survive cyclic upstream groups", () => {
  const root = group("root", "nested");
  const nested = group("nested", "leaf");
  assert.deepEqual(strategyPath(root, new Map([["nested", nested]])), [
    "root",
    "nested",
    "leaf",
  ]);
  assert.deepEqual(
    strategyPath(root, new Map([["nested", group("nested", "root")]])),
    ["root", "nested"],
  );
});

test("workspace links preserve controller context and replace only the destination view", () => {
  const link = workspaceLink(
    "?host=core.example&port=9443&protocol=https&group=old&section=general",
    "/activity",
    { view: "connections" },
  );
  assert.equal(link.pathname, "/activity");
  const params = new URLSearchParams(link.search);
  assert.equal(params.get("host"), "core.example");
  assert.equal(params.get("protocol"), "https");
  assert.equal(params.get("view"), "connections");
  assert.equal(params.has("group"), false);
  assert.equal(params.has("section"), false);
});
