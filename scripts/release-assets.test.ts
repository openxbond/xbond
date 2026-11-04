import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildZipBuffer, checksum } from "./artifact.ts";
import { assemble, buildPages, packExtension } from "./release-assets.ts";
import { cliAsset, releaseTargets, releaseVersion } from "./release-version.ts";

const tag = "v0.4.2";
const stores = [
  "https://apps.apple.com/us/app/id123",
  "https://chromewebstore.google.com/detail/xbond/example",
  "https://microsoftedge.microsoft.com/addons/detail/xbond/example",
];

test("stable tags produce a monotonic cross-platform build number", () => {
  assert.equal(releaseVersion(tag).build, 402);
  assert.ok(releaseVersion("v1.0.0").build > releaseVersion("v0.99.99").build);
  for (const invalid of [
    "0.4.2",
    "v0.0.0",
    "v0.4.2-beta.1",
    "v0.4.2+build",
    "v0.04.2",
    "v0.4.2\n",
    "v0.100.0",
  ]) {
    assert.throws(() => releaseVersion(invalid));
  }
});

test("Pages requires every signed release asset and rejects replaced bytes", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "xbond-release-test-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const put = (name: string, data: string | Buffer = "fixture") =>
    fs.writeFileSync(path.join(directory, name), data);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const key = Buffer.from(
    publicKey.export({ format: "jwk" }).x ?? "",
    "base64url",
  ).toString("base64");

  for (const [osName, arch] of releaseTargets) {
    put(cliAsset(tag, osName, arch));
    const stem = `xbond-desktop-${tag}-${osName}-${arch}`;
    const installer =
      stem +
      (osName === "windows"
        ? ".exe"
        : osName === "linux"
          ? ".AppImage"
          : ".dmg");
    const updater = osName === "darwin" ? stem + ".app.tar.gz" : installer;
    put(installer);
    put(updater);
    put(updater + ".sig", Buffer.from("fixture").toString("base64"));
  }
  const extension = fs.mkdtempSync(
    path.join(os.tmpdir(), "xbond-extension-test-"),
  );
  t.after(() => fs.rmSync(extension, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(extension, "manifest.json"),
    '{"manifest_version":3,"version":"0.1.0"}',
  );
  packExtension(
    extension,
    path.join(directory, `xbond-extension-${tag}.zip`),
    tag,
  );
  put(
    "dashboard.zip",
    buildZipBuffer([{ name: "index.html", data: "<h1>Dashboard</h1>" }]),
  );
  put("release-evidence.json", "{}");
  assert.throws(() => assemble(directory, tag, "", pem, key), /android/);
  put(`xbond-android-${tag}.apk`);
  assert.throws(
    () => assemble(directory, tag, "", pem, "wrong"),
    /does not match/,
  );
  assemble(directory, tag, "<script>test</script>", pem, key);
  const pages = path.join(directory, "pages");
  buildPages(directory, pages, tag, stores, key);
  assert.equal(
    fs.readFileSync(path.join(pages, "index.html"), "utf8"),
    "<h1>Dashboard</h1>",
  );
  const downloads = fs.readFileSync(
    path.join(pages, "download/index.html"),
    "utf8",
  );
  assert.match(downloads, /&lt;script&gt;/);
  assert.match(downloads, /xbond-desktop-v0\.4\.2-linux-arm64\.AppImage/);
  assert.match(downloads, /App Store/);
  const sumFile = path.join(directory, "SHA256SUMS");
  const originalSum = checksum(path.join(directory, "desktop.json"));
  put("desktop.json", "{}");
  assert.throws(
    () => buildPages(directory, pages, tag, stores, key),
    /checksum mismatch/,
  );
  const sums = fs.readFileSync(sumFile, "utf8");
  put(
    "SHA256SUMS",
    sums.replace(originalSum, checksum(path.join(directory, "desktop.json"))),
  );
  assert.throws(
    () => buildPages(directory, pages, tag, stores, key),
    /asset mismatch/,
  );
});
