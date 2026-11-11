import assert from "node:assert/strict";
import { test } from "node:test";

import {
  migrateExternals,
  resolveControlTarget,
  streamURL,
  type Controller,
  type TargetSelection,
} from "../src/controller.ts";

const externals: Controller[] = [
  {
    id: "remote-a",
    name: "Remote A",
    url: "http://192.168.1.10:9090",
    secret: "a-secret",
  },
];
const daemonSelection: TargetSelection = { kind: "daemon" };
const daemon = {
  core: {
    url: "http://127.0.0.1:49152",
    secret: "daemon-fixture",
  },
};

test("the built-in target resolves as local only when the host declares a daemon", () => {
  // 純 Web：沒有 daemon 身份，也沒有已保存的外部控制器 → 無目標。
  assert.equal(resolveControlTarget([], daemonSelection).kind, "none");
  // 宿主聲明 daemon：即使尚未取得首次狀態，身份也是本機。
  const hosted = resolveControlTarget([], daemonSelection, { daemon: {} });
  assert.equal(hosted.kind, "daemon");
  assert.ok(hosted.kind === "daemon" && hosted.endpoint === null);
  // 用戶選中的外部控制器照常解析。
  const selected = resolveControlTarget(externals, {
    kind: "controller",
    id: "remote-a",
  });
  assert.equal(selected.kind, "controller");
});

test("desktop traffic and logs use the core advertised by LocalAPI", () => {
  const target = resolveControlTarget(externals, daemonSelection, { daemon });
  assert.equal(target.kind, "daemon");
  assert.ok(target.kind === "daemon" && target.endpoint);
  assert.equal(
    streamURL(target.endpoint.url, "traffic", target.endpoint.secret),
    "ws://127.0.0.1:49152/traffic?token=daemon-fixture",
  );
  assert.equal(
    streamURL(target.endpoint.url, "logs?level=info", target.endpoint.secret),
    "ws://127.0.0.1:49152/logs?level=info&token=daemon-fixture",
  );
});

test("an unreachable daemon keeps its local identity without a guessed endpoint", () => {
  // LocalAPI 尚未取得首次狀態：身份留在本機（供離線處理），但不對佔位地址發請求。
  const offline = resolveControlTarget(externals, daemonSelection, {
    daemon: {},
  });
  assert.equal(offline.kind, "daemon");
  assert.ok(offline.kind === "daemon" && offline.endpoint === null);
  // daemon 注入的 metadata 是真實端點：離線期間仍可用於載入與失敗處理。
  const injected = resolveControlTarget(externals, daemonSelection, {
    daemon: {},
    meta: "http://:daemon-fixture@127.0.0.1:49152",
  });
  assert.equal(injected.kind, "daemon");
  assert.ok(injected.kind === "daemon" && injected.endpoint);
  assert.equal(injected.endpoint.url, "http://127.0.0.1:49152");
});

test("a selected external controller keeps its own endpoint; meta never hijacks it", () => {
  const target = resolveControlTarget(
    externals,
    {
      kind: "controller",
      id: "remote-a",
    },
    { daemon, meta: "http://:other@127.0.0.1:49153" },
  );
  assert.equal(target.kind, "controller");
  assert.ok(target.kind === "controller");
  assert.equal(target.controller.id, "remote-a");
  assert.equal(target.endpoint.url, "http://192.168.1.10:9090");
});

test("a missing selection falls back to the host's daemon", () => {
  const target = resolveControlTarget(
    externals,
    {
      kind: "controller",
      id: "deleted",
    },
    { daemon },
  );
  assert.equal(target.kind, "daemon");
});

test("an ad-hoc launch target never inherits the daemon credential", () => {
  const target = resolveControlTarget(externals, daemonSelection, {
    daemon,
    search: "?host=remote.example&port=9443&protocol=https",
  });
  assert.equal(target.kind, "controller");
  assert.ok(target.kind === "controller");
  assert.equal(target.controller.url, "https://remote.example:9443");
  assert.equal(target.controller.secret, "");
  const withSecret = resolveControlTarget(externals, daemonSelection, {
    daemon,
    search: "?host=remote.example&secret=given",
  });
  assert.ok(withSecret.kind === "controller");
  assert.equal(withSecret.controller.secret, "given");
  // 沒有 host 的參數不構成目標指定：保留本機。
  const noHost = resolveControlTarget(externals, daemonSelection, {
    daemon,
    search: "?port=9443",
  });
  assert.equal(noHost.kind, "daemon");
});

test("bridge targets take precedence over launch URLs without inheriting daemon control", () => {
  const bridge: Controller = {
    id: "clashx",
    name: "ClashX",
    url: "http://127.0.0.1:9000",
    secret: "",
  };
  const target = resolveControlTarget(externals, daemonSelection, {
    daemon,
    bridge,
    search: "?host=remote.example",
  });
  assert.equal(target.kind, "controller");
  assert.ok(target.kind === "controller");
  assert.deepEqual(target.controller, bridge);
});

test("invalid launch parameters preserve the local target", () => {
  const target = resolveControlTarget(externals, daemonSelection, {
    daemon,
    search: "?host=%20",
  });
  assert.equal(target.kind, "daemon");
});

test("migrateExternals drops built-in copies and keeps user entries", () => {
  const migrated = migrateExternals([
    // 舊版種進列表的內建身份（含被重新賦 id 的幽靈形態）：遷移時丟棄。
    { id: "default", name: "XBond", url: "http://127.0.0.1:9090", secret: "" },
    {
      id: "stale-random",
      name: "XBond",
      url: "http://127.0.0.1:9090",
      secret: "",
    },
    // 壞記錄丟棄。
    { url: "file:///secret" },
    {},
    // 真實外部條目保留；缺 id 的補新 id。
    { hostname: "192.168.1.2", port: 9090, secret: "two" },
  ]);
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].url, "http://192.168.1.2:9090");
  assert.equal(migrated[0].secret, "two");
  assert.notEqual(migrated[0].id, "default");
});
