import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  type ZipEntryInput,
  buildZipBuffer,
  checksum,
  packageDistribution,
  validateArchive,
} from "./artifact.ts";

function withTempDir(fn: (root: string, archivePath: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xbond-artifact-test-"));
  try {
    fn(root, path.join(root, "dashboard.zip"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeZip(archivePath: string, entries: ZipEntryInput[]): void {
  const fullEntries: ZipEntryInput[] = [
    { name: "index.html", data: "<html>compiled</html>" },
    ...entries,
  ];
  fs.writeFileSync(archivePath, buildZipBuffer(fullEntries));
}

test("real distribution shape and checksum extract", () => {
  withTempDir((root, archive) => {
    writeZip(archive, [
      { name: "assets/app.js", data: "console.log('ok')" },
      { name: ".nojekyll", data: "" },
      { name: "icons/icon-192.png", data: Buffer.from("png") },
    ]);
    const sums = path.join(root, "SHA256SUMS");
    const dashboard = `${checksum(archive)}  dashboard.zip\n`;
    const cli = `${"1".repeat(64)}  xbond-v0.3.0-linux-amd64\n`;
    fs.writeFileSync(sums, cli + dashboard, "utf8");
    const siteDir = path.join(root, "site");
    validateArchive(archive, sums, siteDir);
    assert.equal(
      fs.statSync(path.join(siteDir, "assets", "app.js")).isFile(),
      true,
    );

    fs.writeFileSync(sums, dashboard + dashboard, "utf8");
    assert.throws(
      () => validateArchive(archive, sums),
      /SHA256SUMS does not match/,
    );

    fs.writeFileSync(sums, `${"0".repeat(64)}  dashboard.zip\n`, "utf8");
    assert.throws(
      () => validateArchive(archive, sums),
      /SHA256SUMS does not match/,
    );
  });
});

test("source, config, maps, credentials, and traversal paths are rejected", () => {
  const badNames = [
    "src/App.tsx",
    "package.json",
    ".env",
    "debug.html",
    "assets/app.js.map",
    "../secret.js",
    "/secret.js",
    "C:/secret.js",
    "assets//app.js",
  ];
  for (const name of badNames) {
    withTempDir((root, archive) => {
      writeZip(archive, [{ name, data: "test" }]);
      const rejectedDir = path.join(root, "rejected");
      assert.throws(() => validateArchive(archive, undefined, rejectedDir));
      assert.equal(fs.existsSync(rejectedDir), false);
    });
  }
});

test("backslash entries are rejected before extraction", () => {
  withTempDir((_root, archive) => {
    writeZip(archive, [{ name: "assets/secret.js", data: "test" }]);
    const raw = fs.readFileSync(archive);
    const patched = Buffer.from(
      raw
        .toString("latin1")
        .replaceAll("assets/secret.js", "assets\\secret.js"),
      "latin1",
    );
    fs.writeFileSync(archive, patched);
    assert.throws(() => validateArchive(archive), /Unsafe archive path/);
  });
});

test("embedded maps and private keys are rejected", () => {
  const badContents = [
    "console.log(1);//# sourceMappingURL=app.js.map",
    "-----BEGIN RSA PRIVATE KEY-----",
    `ghp_${"a".repeat(36)}`,
  ];
  for (const content of badContents) {
    withTempDir((_root, archive) => {
      writeZip(archive, [{ name: "assets/app.js", data: content }]);
      assert.throws(
        () => validateArchive(archive),
        /Secret or source map reference/,
      );
    });
  }
});

test("symlinks and duplicate case-insensitive paths are rejected", () => {
  withTempDir((_root, archive) => {
    writeZip(archive, [
      {
        name: "assets/linked.js",
        data: "../secret",
        createSystem: 3,
        externalAttr: ((0o120000 | 0o777) << 16) >>> 0,
      },
    ]);
    assert.throws(() => validateArchive(archive), /Unsupported archive entry/);

    writeZip(archive, [
      { name: "assets/App.js", data: "one" },
      { name: "assets/app.js", data: "two" },
    ]);
    assert.throws(() => validateArchive(archive), /Duplicate archive path/);
  });
});

test("packaging is deterministic and requires root index.html", () => {
  withTempDir((root) => {
    const dist = path.join(root, "dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, "index.html"), "<html>app</html>");
    fs.writeFileSync(
      path.join(dist, "splashscreen.html"),
      "<html>splash</html>",
    );
    const one = packageDistribution(dist, path.join(root, "one"));
    const two = packageDistribution(dist, path.join(root, "two"));
    assert.equal(one, two);

    fs.unlinkSync(path.join(dist, "index.html"));
    assert.throws(
      () => packageDistribution(dist, path.join(root, "empty")),
      /index\.html/,
    );
  });
});
