import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Tauri derives the deb/rpm package name as kebab-case(productName) with no
// override field, so Linux pins a lowercase productName. The desktop entry
// keeps the XBond display name through a template instead of {{name}}.
const root = fileURLToPath(new URL("../..", import.meta.url));
const tauriDir = path.join(root, "src-tauri");

interface LinuxConfig {
  productName?: string;
  bundle?: {
    linux?: {
      deb?: { desktopTemplate?: string };
      rpm?: { desktopTemplate?: string };
    };
  };
}

test("linux packages use the xbond package name", () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(tauriDir, "tauri.linux.conf.json"), "utf8"),
  ) as LinuxConfig;
  assert.equal(config.productName, "xbond");
  for (const format of ["deb", "rpm"] as const) {
    const template = config.bundle?.linux?.[format]?.desktopTemplate;
    assert.ok(template, `${format} must pin a desktop template`);
    const text = fs.readFileSync(path.join(tauriDir, template), "utf8");
    assert.match(text, /^Name=XBond$/m);
    assert.doesNotMatch(text, /Name=\{\{name\}\}/);
  }
});
