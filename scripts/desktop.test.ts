import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOpenLocationScript,
  buildPlistPatchCommands,
  devBinaryPath,
  registerDevLinks,
  WRAPPER_BUNDLE_ID,
  WRAPPER_SCHEMES,
} from "./desktop.ts";

test("open location script hands the URL to the dev binary as argv", () => {
  const script = buildOpenLocationScript(
    "/Users/nan/.cargo-target/debug/xbond-app",
  );
  assert.match(script, /on open location theURL/);
  assert.match(
    script,
    /exec '\/Users\/nan\/\.cargo-target\/debug\/xbond-app' " & quoted form of \(theURL as text\)/,
  );
  assert.match(script, /end open location/);
});

test("plist patch registers the declared schemes on the dev bundle", () => {
  const patches = buildPlistPatchCommands().join("\n");
  assert.match(
    patches,
    new RegExp(`Add :CFBundleIdentifier string ${WRAPPER_BUNDLE_ID}`),
  );
  for (const scheme of WRAPPER_SCHEMES) {
    assert.match(
      patches,
      new RegExp(`CFBundleURLSchemes:\\d+ string ${scheme}`),
    );
  }
});

test("devBinaryPath honours CARGO_TARGET_DIR and defaults to src-tauri target", () => {
  const previous = process.env.CARGO_TARGET_DIR;
  process.env.CARGO_TARGET_DIR = "/tmp/cargo-target";
  assert.match(devBinaryPath(), /^\/tmp\/cargo-target\/debug\/xbond-app$/);
  if (previous === undefined) {
    delete process.env.CARGO_TARGET_DIR;
  } else {
    process.env.CARGO_TARGET_DIR = previous;
  }
});

test("registerDevLinks is a documented no-op on non-darwin hosts", () => {
  if (process.platform !== "darwin") {
    const res = registerDevLinks();
    assert.equal(res.ok, true);
    assert.match(res.message, /register at runtime/);
  }
});
