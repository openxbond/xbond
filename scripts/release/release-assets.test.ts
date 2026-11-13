import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildZipBuffer, checksum } from "./artifact.ts";
import { assemble, buildPages, verifyManifestAsset } from "./release-assets.ts";
import {
  androidAbis,
  cliAsset,
  releaseTargets,
  releaseVersion,
} from "./release-version.ts";

const tag = "v0.4.2";
const stores = ["https://apps.apple.com/us/app/id123"];

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
    if (osName === "linux") {
      put(stem + ".deb");
      put(stem + ".rpm");
    }
  }
  put(
    "dashboard.zip",
    buildZipBuffer([{ name: "index.html", data: "<h1>Dashboard</h1>" }]),
  );
  put("release-evidence.json", "{}");
  assert.throws(() => assemble(directory, tag, "", pem, key), /android/);
  put(`xbond-android-${tag}.apk`);
  for (const abi of androidAbis) {
    put(`xbond-android-${tag}-${abi}.apk`);
  }
  const rpm = `xbond-desktop-${tag}-linux-arm64.rpm`;
  fs.unlinkSync(path.join(directory, rpm));
  assert.throws(
    () => assemble(directory, tag, "", pem, key),
    /linux-arm64\.rpm/,
  );
  put(rpm);
  assert.throws(
    () => assemble(directory, tag, "", pem, "wrong"),
    /does not match/,
  );
  assemble(directory, tag, "<script>test</script>", pem, key);
  verifyManifestAsset(directory, tag, "release-evidence", key);
  verifyManifestAsset(directory, tag, "desktop-linux-arm64-rpm", key);
  verifyManifestAsset(directory, tag, "android-universal", key);
  verifyManifestAsset(directory, tag, "android-arm64-v8a", key);
  put("release-evidence.json", '{"mode":"release"}');
  assert.throws(
    () => verifyManifestAsset(directory, tag, "release-evidence", key),
    /asset mismatch/,
  );
  put("release-evidence.json", "{}");
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
  for (const arch of ["amd64", "arm64"]) {
    assert.ok(downloads.includes(`xbond-desktop-${tag}-linux-${arch}.deb`));
    assert.ok(downloads.includes(`xbond-desktop-${tag}-linux-${arch}.rpm`));
  }
  for (const abi of androidAbis) {
    assert.ok(downloads.includes(`xbond-android-${tag}-${abi}.apk`));
  }
  assert.ok(downloads.includes(`xbond-android-${tag}.apk`));
  // 默认推荐在最前：arm64-v8a 带推荐徽章，universal 兜底殿后。
  assert.match(downloads, /<strong>arm64-v8a<\/strong>/);
  assert.match(downloads, /data-i18n="recommended">Recommended</);
  assert.ok(
    downloads.indexOf('data-i18n="mostPhones"') <
      downloads.indexOf('data-i18n="anyDevice"'),
  );
  assert.match(downloads, /App Store/);
  buildPages(directory, pages, tag, [], key);
  const directDownloads = fs.readFileSync(
    path.join(pages, "download/index.html"),
    "utf8",
  );
  assert.doesNotMatch(
    directDownloads,
    /App Store|Chrome Web Store|Edge Add-ons/,
  );
  assert.match(directDownloads, /TestFlight invitation/);
  buildPages(
    directory,
    pages,
    tag,
    ["", "https://testflight.apple.com/join/Example1"],
    key,
  );
  const withTestFlight = fs.readFileSync(
    path.join(pages, "download/index.html"),
    "utf8",
  );
  assert.match(withTestFlight, /<strong>TestFlight<\/strong>/);
  assert.match(
    withTestFlight,
    /href="https:\/\/testflight\.apple\.com\/join\/Example1"/,
  );
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
