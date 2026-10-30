import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveControlTarget, type Controller } from "../src/controller.ts";

const saved: Controller = {
  id: "default",
  name: "XBond",
  url: "http://127.0.0.1:9090",
  secret: "",
};
const daemon = {
  id: saved.id,
  core: {
    url: "http://127.0.0.1:49152",
    secret: "daemon-fixture",
  },
};

test("the built-in target is identified only when its daemon is configured", () => {
  assert.equal(resolveControlTarget(saved).kind, "controller");
  assert.equal(resolveControlTarget(saved, { daemon }).kind, "daemon");
  assert.equal(
    resolveControlTarget({ ...saved, id: "remote" }, { daemon }).kind,
    "controller",
  );
});

test("configured daemon identity survives injected metadata awaiting its first status", () => {
  const target = resolveControlTarget(saved, {
    daemon: { id: saved.id },
    meta: "http://:daemon-fixture@127.0.0.1:49152",
  });
  assert.equal(target.kind, "daemon");
  assert.equal(target.controller.url, "http://127.0.0.1:49152");
});

test("verified static metadata keeps the daemon binding after its core endpoint rotates", () => {
  const meta = "http://:daemon-fixture@127.0.0.1:49152";
  const rotated = {
    id: saved.id,
    core: { url: "http://127.0.0.1:49153", secret: "rotated-fixture" },
    verifiedMeta: meta,
  };
  assert.equal(
    resolveControlTarget(saved, { daemon: rotated, meta }).kind,
    "daemon",
  );
  assert.equal(
    resolveControlTarget(saved, {
      daemon: rotated,
      meta: "http://:other-fixture@127.0.0.1:49154",
    }).kind,
    "controller",
  );
});

test("a launch that changes endpoints never inherits a saved or injected credential", () => {
  const authenticated = { ...saved, secret: "saved-fixture" };
  for (const search of [
    "?host=remote.example",
    "?port=9443",
    "?protocol=https",
  ]) {
    const target = resolveControlTarget(authenticated, { daemon, search });
    assert.equal(target.kind, "controller");
    assert.equal(target.controller.secret, "");
  }
  const injected = resolveControlTarget(saved, {
    daemon,
    meta: "http://:daemon-fixture@127.0.0.1:49152",
    search: "?host=remote.example",
  });
  assert.equal(injected.kind, "controller");
  assert.equal(injected.controller.secret, "");
  assert.equal(
    resolveControlTarget(authenticated, {
      daemon,
      search: "?host=127.0.0.1&port=9090",
    }).controller.secret,
    authenticated.secret,
  );
});

test("query launch targets override the daemon even when they retain its saved ID", () => {
  const target = resolveControlTarget(saved, {
    daemon,
    search: "?host=remote.example&port=9443&protocol=https&secret=remote",
  });
  assert.equal(target.kind, "controller");
  assert.equal(target.controller.url, "https://remote.example:9443");
  assert.equal(target.controller.secret, "remote");
  assert.equal(target.controller.id, saved.id);
});

test("ordinary navigation parameters do not detach the built-in daemon", () => {
  assert.equal(
    resolveControlTarget(saved, {
      daemon,
      search: "?section=network&group=default",
    }).kind,
    "daemon",
  );
});

test("injected controller metadata must match the daemon endpoint and credential to gain runtime control", () => {
  assert.equal(
    resolveControlTarget(saved, {
      daemon,
      meta: "http://:daemon-fixture@127.0.0.1:49152",
    }).kind,
    "daemon",
  );
  for (const meta of [
    "https://:daemon-fixture@remote.example",
    "http://:other-fixture@127.0.0.1:49152",
  ]) {
    assert.equal(
      resolveControlTarget(saved, { daemon, meta }).kind,
      "controller",
    );
  }
});

test("bridge targets take precedence over launch URLs without inheriting daemon control", () => {
  const bridge = { ...saved, id: "clashx", url: "http://127.0.0.1:9000" };
  const target = resolveControlTarget(saved, {
    daemon,
    bridge,
    search: "?host=remote.example",
  });
  assert.equal(target.kind, "controller");
  assert.deepEqual(target.controller, bridge);
});

test("invalid metadata preserves a usable target while a valid explicit query remains external", () => {
  assert.equal(
    resolveControlTarget(saved, { daemon, meta: "invalid" }).kind,
    "daemon",
  );
  const target = resolveControlTarget(saved, {
    daemon,
    meta: "invalid",
    search: "?port=9091",
  });
  assert.equal(target.kind, "controller");
  assert.equal(target.controller.url, "http://127.0.0.1:9091");
});
