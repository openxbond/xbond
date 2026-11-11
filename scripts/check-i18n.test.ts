import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkHardcodedAttributes,
  checkI18n,
  checkTrayI18n,
  extractInterpolationTokens,
  flattenDict,
  hasBrokenBraces,
} from "./check-i18n.ts";

test("extractInterpolationTokens extracts tokens accurately", () => {
  assert.deepEqual(extractInterpolationTokens("Hello {{name}}!"), ["name"]);
  assert.deepEqual(
    extractInterpolationTokens("Error {{code}}: {{ message }} on {{ code }}"),
    ["code", "message"],
  );
  assert.deepEqual(extractInterpolationTokens("No variables here"), []);
});

test("hasBrokenBraces catches single brace syntax", () => {
  assert.equal(hasBrokenBraces("Invalid {variable} syntax"), "{variable}");
  assert.equal(hasBrokenBraces("Valid {{variable}} syntax"), null);
  assert.equal(hasBrokenBraces("Normal string without braces"), null);
});

test("flattenDict flattens nested objects into dot paths", () => {
  const dict = {
    common: {
      ok: "OK",
      dialog: {
        title: "Title",
      },
    },
    version: "1.0",
  };
  const flat = flattenDict(dict);
  assert.equal(flat.get("common.ok"), "OK");
  assert.equal(flat.get("common.dialog.title"), "Title");
  assert.equal(flat.get("version"), "1.0");
  assert.equal(flat.size, 3);
});

test("checkHardcodedAttributes detects hardcoded Chinese attributes", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xbond-i18n-test-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const uiDir = path.join(tempDir, "packages/client-ui/src/components");
  fs.mkdirSync(uiDir, { recursive: true });

  fs.writeFileSync(
    path.join(uiDir, "bad-component.tsx"),
    `export function Bad() {
  return (
    <input
      aria-label="搜索节点"
      placeholder="请输入关键词"
    />
  );
}`,
  );

  fs.writeFileSync(
    path.join(uiDir, "good-component.tsx"),
    `export function Good() {
  return (
    <input
      aria-label={t("search")}
      placeholder={t("placeholder")}
    />
  );
}`,
  );

  const problems = checkHardcodedAttributes(tempDir);
  assert.equal(problems.length, 2);
  assert.match(problems[0].message, /aria-label="搜索节点"/);
  assert.match(problems[1].message, /placeholder="请输入关键词"/);
});

test("checkTrayI18n catches missing tray locales", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xbond-tray-test-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const trayDir = path.join(tempDir, "src-tauri/src");
  fs.mkdirSync(trayDir, { recursive: true });

  // Missing FA
  fs.writeFileSync(
    path.join(trayDir, "tray.rs"),
    `pub const ZH_HK: TrayI18n = TrayI18n {};
pub const ZH_CN: TrayI18n = TrayI18n {};
pub const EN_US: TrayI18n = TrayI18n {};
pub const KO: TrayI18n = TrayI18n {};`,
  );

  const problems = checkTrayI18n(tempDir);
  assert.equal(problems.length, 1);
  assert.match(
    problems[0].message,
    /Missing tray i18n definition for locale 'FA'/,
  );
});

test("checkI18n passes cleanly on actual xbond codebase", async () => {
  const rootDir = fileURLToPath(new URL("..", import.meta.url));
  const problems = await checkI18n(rootDir);
  assert.deepEqual(problems, []);
});
