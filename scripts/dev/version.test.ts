import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  readVersion,
  setVersion,
  verifyVersion,
  versionSources,
} from "./version.ts";

const repository = fileURLToPath(new URL("../..", import.meta.url));

test("the tracked version agrees across every source", () => {
  assert.deepEqual(verifyVersion(repository), []);
});

test("version:set rewrites every source and rejects candidate versions", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xbond-version-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const source of versionSources) {
    const from = path.join(repository, source.file);
    const to = path.join(root, source.file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }

  assert.throws(
    () => setVersion("2.3.4-rc.1", root),
    /release candidates are Tags/i,
  );

  setVersion("2.3.4", root);
  assert.equal(readVersion(root), "2.3.4");
  assert.deepEqual(verifyVersion(root), []);

  const tauriConfig = path.join(root, "src-tauri/tauri.conf.json");
  fs.writeFileSync(
    tauriConfig,
    fs.readFileSync(tauriConfig, "utf8").replace('"2.3.4"', '"9.9.9"'),
  );
  assert.deepEqual(verifyVersion(root), [
    "src-tauri/tauri.conf.json: 9.9.9 does not match 2.3.4",
  ]);
});
