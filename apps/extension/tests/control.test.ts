import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { parseCommand } from "../src/shared/control.ts";
import type { ExtensionConfig } from "../src/shared/extension-config.ts";

const local: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
let proxyValue: unknown = { mode: "system" };
let holder = "controllable_by_this_extension";
let failSet = false;
const runtime: {
  lastError: { message: string } | undefined;
  sendMessage: () => void;
} = { lastError: undefined, sendMessage: () => {} };
function area(data: Record<string, unknown>) {
  return {
    get: (keys: string[], callback: (items: Record<string, unknown>) => void) =>
      callback(
        Object.fromEntries(
          keys.filter((k) => k in data).map((k) => [k, data[k]]),
        ),
      ),
    set: (items: Record<string, unknown>, callback: () => void) => {
      Object.assign(data, items);
      callback?.();
    },
    remove: (keys: string[], callback: () => void) => {
      for (const key of keys) delete data[key];
      callback?.();
    },
  };
}
Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: {
    runtime,
    storage: { local: area(local), session: area(session) },
    proxy: {
      settings: {
        get: (_details: unknown, cb: (value: unknown) => void) =>
          cb({ levelOfControl: holder, value: proxyValue }),
        set: (details: { value: unknown }, cb: () => void) => {
          if (failSet) runtime.lastError = { message: "denied" };
          else {
            proxyValue = details.value;
            holder = "controlled_by_this_extension";
          }
          cb();
          runtime.lastError = undefined;
        },
        clear: (_details: unknown, cb: () => void) => {
          proxyValue = { mode: "system" };
          holder = "controllable_by_this_extension";
          cb();
        },
      },
    },
  },
});
Object.defineProperty(globalThis, "__XBOND_API_ORIGIN__", {
  value: "https://cloud.example.org",
});
const { handleCommand, reconcile } =
  await import("../src/background/controller.ts");
const config: ExtensionConfig = {
  version: 1,
  proxyToken: "px-" + "ab".repeat(24),
  nodes: [
    {
      name: "Tokyo",
      server: "edge.example.org",
      port: 443,
      password: "aabb".repeat(8),
    },
  ],
  groups: [{ name: "Main", type: "select", members: ["Tokyo", "DIRECT"] }],
  rules: [],
  ruleSets: {},
  final: "Main",
};
beforeEach(async () => {
  for (const key of Object.keys(local)) delete local[key];
  for (const key of Object.keys(session)) delete session[key];
  Object.assign(local, {
    "xbond.refresh": "private-refresh",
    "xbond.config": config,
    "xbond.config.bound": true,
    "xbond.mode": "global",
    "xbond.selection": { Main: "Tokyo" },
  });
  session["xbond.access"] = {
    token: "private-access",
    expiresAt: Date.now() + 100000,
  };
  holder = "controllable_by_this_extension";
  proxyValue = { mode: "system" };
  failSet = false;
  await reconcile();
});
test("disabled snapshot retains choices and strips every credential", async () => {
  const reply = await handleCommand({ type: "get-snapshot" });
  assert.equal(reply.ok, true);
  if (!reply.ok) return;
  assert.equal(reply.snapshot.mode, "global");
  assert.equal(reply.snapshot.selection.Main, "Tokyo");
  assert.equal(reply.snapshot.signedIn, true);
  assert.equal(reply.snapshot.recording, false);
  assert.doesNotMatch(
    JSON.stringify(reply.snapshot),
    /private-access|private-refresh|px-|aabbaabb|password/,
  );
});
test("logout releases the proxy and cached credentials cannot re-enable it", async () => {
  assert.equal(
    (await handleCommand({ type: "set-enabled", enabled: true })).ok,
    true,
  );
  await handleCommand({ type: "logout" });
  assert.equal(holder, "controllable_by_this_extension");
  const reply = await handleCommand({ type: "set-enabled", enabled: true });
  assert.equal(reply.ok, false);
  assert.equal(reply.snapshot?.signedIn, false);
  assert.equal(reply.snapshot?.nodes.length, 0);
  assert.ok(local["xbond.config"]);
  assert.equal(local["xbond.enabled"], false);
});
test("failed browser application rolls back selection instead of confirming a false success", async () => {
  await handleCommand({ type: "set-enabled", enabled: true });
  failSet = true;
  const reply = await handleCommand({
    type: "set-selection",
    group: "Main",
    member: "DIRECT",
  });
  assert.equal(reply.ok, false);
  assert.equal(reply.snapshot?.selection.Main, "Tokyo");
  const invalid = await handleCommand({
    type: "set-selection",
    group: "Main",
    member: "missing",
  });
  assert.equal(invalid.ok, false);
});
test("conflicts never steal control; following browser releases only our setting", async () => {
  holder = "controlled_by_other_extensions";
  const held = await handleCommand({ type: "set-enabled", enabled: true });
  assert.equal(held.ok, false);
  assert.equal(holder, "controlled_by_other_extensions");
  holder = "controllable_by_this_extension";
  await handleCommand({ type: "set-enabled", enabled: true });
  const direct = await handleCommand({ type: "set-mode", mode: "direct" });
  assert.equal(direct.ok, true);
  assert.equal(holder, "controllable_by_this_extension");
});
test("refresh-token state survives a browser session restart and is not mistaken for signed out", async () => {
  delete session["xbond.access"];
  const reply = await handleCommand({ type: "get-snapshot" });
  assert.equal(reply.ok, true);
  assert.equal(reply.snapshot?.signedIn, true);
});
test("runtime commands are validated before dispatch", () => {
  assert.equal(parseCommand({ type: "set-enabled", enabled: "yes" }), null);
  assert.equal(parseCommand({ type: "set-mode", mode: "script" }), null);
  assert.equal(
    parseCommand({
      type: "save-override",
      override: { domain: "example.org" },
    }),
    null,
  );
});
