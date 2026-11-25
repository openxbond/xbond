import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseSha256Sums,
  renderPackageManifests,
  writePackageManifests,
} from "./package-manifests.ts";
import { cliAsset, desktopRelease, releaseTargets } from "./release-version.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

function makeSyntheticChecksums(tag: string): Map<string, string> {
  const entries = new Map<string, string>();
  let idx = 1;
  const nextDigest = () => (idx++).toString(16).padStart(64, "a");

  for (const [osName, arch] of releaseTargets) {
    entries.set(cliAsset(tag, osName, arch), nextDigest());
    const rel = desktopRelease(tag, osName, arch);
    entries.set(rel.installer, nextDigest());
    for (const pkg of rel.packages) {
      entries.set(pkg.name, nextDigest());
    }
  }
  return entries;
}

test("parseSha256Sums rejects malformed and duplicate entries", () => {
  const valid =
    `${"a".repeat(64)}  xbond-v1.1.2-linux-amd64\n` +
    `${"b".repeat(64)}  xbond-desktop-v1.1.2-darwin-arm64.dmg\n`;
  const parsed = parseSha256Sums(valid);
  assert.equal(parsed.size, 2);

  assert.throws(
    () => parseSha256Sums("not-a-digest  foo"),
    /Invalid SHA256SUMS/,
  );
  assert.throws(
    () =>
      parseSha256Sums(
        `${"a".repeat(64)}  same-file\n${"b".repeat(64)}  same-file\n`,
      ),
    /Duplicate SHA256SUMS/,
  );
  assert.throws(() => parseSha256Sums("\n  \n"), /contains no entries/);
});

test("renderPackageManifests enforces stable tags and complete checksums", () => {
  const checksums = makeSyntheticChecksums("v9.9.9");
  assert.throws(
    () =>
      renderPackageManifests({
        tag: "v9.9.9-rc.1",
        checksums,
        releaseDate: "2026-11-25",
      }),
    /stable releases/,
  );

  const incomplete = new Map(checksums);
  incomplete.delete("xbond-desktop-v9.9.9-darwin-arm64.dmg");
  assert.throws(
    () =>
      renderPackageManifests({
        tag: "v9.9.9",
        checksums: incomplete,
        releaseDate: "2026-11-25",
      }),
    /xbond-desktop-v9\.9\.9-darwin-arm64\.dmg/,
  );

  assert.throws(
    () =>
      renderPackageManifests({
        tag: "v9.9.9",
        checksums,
        releaseDate: "2026/11/25",
      }),
    /Invalid releaseDate/,
  );
});

test("renderPackageManifests renders all five ecosystems and writePackageManifests prunes stale WinGet dirs", (t) => {
  const tag = "v2.4.1";
  const checksums = makeSyntheticChecksums(tag);
  const files = renderPackageManifests({
    tag,
    checksums,
    releaseDate: "2026-12-01",
  });

  assert.equal(files.size, 12);

  const cask = files.get("homebrew/Casks/xbond.rb")!;
  assert.match(cask, /app "XBond\.app"/);
  assert.match(cask, /net\.xbond\.app/);
  assert.match(
    cask,
    new RegExp(checksums.get("xbond-desktop-v2.4.1-darwin-arm64.dmg")!),
  );

  const formula = files.get("homebrew/Formula/xbond-cli.rb")!;
  assert.match(formula, /class XbondCli < Formula/);
  assert.match(formula, /license "AGPL-3\.0-only"/);

  const scoopDesktop = JSON.parse(files.get("scoop/xbond.json")!) as {
    version: string;
    architecture: Record<string, { url: string; hash: string }>;
    installer?: unknown;
    uninstaller?: unknown;
    post_install?: string;
    shortcuts: string[][];
  };
  assert.equal(scoopDesktop.version, "2.4.1");
  assert.match(scoopDesktop.architecture["64bit"]!.url, /#\/dl\.7z$/);
  assert.equal(
    scoopDesktop.architecture["64bit"]!.hash,
    checksums.get("xbond-desktop-v2.4.1-windows-amd64.exe"),
  );
  assert.equal(scoopDesktop.installer, undefined);
  assert.equal(scoopDesktop.uninstaller, undefined);
  assert.match(scoopDesktop.post_install ?? "", /\$PLUGINSDIR/);
  assert.deepEqual(scoopDesktop.shortcuts, [["xbond-app.exe", "XBond"]]);

  const scoopCli = JSON.parse(files.get("scoop/xbond-cli.json")!) as {
    bin: string;
    architecture: Record<string, { hash: string }>;
  };
  assert.equal(scoopCli.bin, "xbond.exe");
  assert.equal(
    scoopCli.architecture.arm64!.hash,
    checksums.get("xbond-v2.4.1-windows-arm64.exe"),
  );

  const wingetInstaller = files.get(
    "winget/manifests/o/OpenXBond/XBond/2.4.1/OpenXBond.XBond.installer.yaml",
  )!;
  assert.match(wingetInstaller, /^Scope: user$/m);
  assert.match(wingetInstaller, /^InstallerType: nullsoft$/m);
  assert.match(wingetInstaller, /^ReleaseDate: 2026-12-01$/m);
  assert.match(wingetInstaller, /^AppsAndFeaturesEntries:$/m);
  assert.match(wingetInstaller, /^\s+- DisplayName: XBond$/m);
  assert.match(wingetInstaller, /^\s+Publisher: xbond$/m);
  assert.match(wingetInstaller, /^\s+DisplayVersion: 2\.4\.1$/m);
  assert.match(wingetInstaller, /^\s+InstallerType: nullsoft$/m);
  assert.match(
    wingetInstaller,
    new RegExp(
      `InstallerSha256: ${checksums.get("xbond-desktop-v2.4.1-windows-amd64.exe")!.toUpperCase()}`,
    ),
  );

  const aurDesktop = files.get("aur/xbond-bin/PKGBUILD")!;
  assert.match(aurDesktop, /webkit2gtk-4\.1/);
  const aurCliSrcinfo = files.get("aur/xbond-cli-bin/.SRCINFO")!;
  assert.match(aurCliSrcinfo, /pkgver = 2\.4\.1/);

  const obtainium = JSON.parse(files.get("obtainium/xbond.json")!) as {
    apps: Array<{
      id: string;
      additionalSettings: string;
    }>;
  };
  assert.equal(obtainium.apps.length, 1);
  assert.equal(obtainium.apps[0]!.id, "net.xbond.app");
  const nested = JSON.parse(obtainium.apps[0]!.additionalSettings) as {
    apkFilterRegEx: string;
    autoApkFilterByArch: boolean;
  };
  assert.equal(nested.apkFilterRegEx, "xbond-android-v.*\\.apk");
  assert.equal(nested.autoApkFilterByArch, true);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xbond-manifests-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const oldWingetDir = path.join(
    tempDir,
    "winget/manifests/o/OpenXBond/XBond/1.0.0",
  );
  fs.mkdirSync(oldWingetDir, { recursive: true });
  fs.writeFileSync(path.join(oldWingetDir, "stale.yaml"), "stale\n");

  writePackageManifests(tempDir, files, "2.4.1");
  assert.equal(fs.existsSync(oldWingetDir), false);
  assert.equal(
    fs.existsSync(
      path.join(
        tempDir,
        "winget/manifests/o/OpenXBond/XBond/2.4.1/OpenXBond.XBond.yaml",
      ),
    ),
    true,
  );
});

test("committed packaging directory holds valid manifests", () => {
  const pkgRoot = path.join(root, "packaging");
  for (const rel of [
    "homebrew/Casks/xbond.rb",
    "homebrew/Formula/xbond-cli.rb",
    "scoop/xbond.json",
    "scoop/xbond-cli.json",
    "aur/xbond-bin/PKGBUILD",
    "aur/xbond-bin/.SRCINFO",
    "aur/xbond-cli-bin/PKGBUILD",
    "aur/xbond-cli-bin/.SRCINFO",
    "obtainium/xbond.json",
  ]) {
    const full = path.join(pkgRoot, rel);
    assert.ok(fs.existsSync(full), `Missing packaging artifact: ${rel}`);
    const content = fs.readFileSync(full, "utf8");
    assert.ok(content.trim().length > 0, `Empty packaging artifact: ${rel}`);
    if (rel.endsWith(".json")) {
      JSON.parse(content);
    }
  }
  const wingetBase = path.join(pkgRoot, "winget/manifests/o/OpenXBond/XBond");
  const versionDirs = fs
    .readdirSync(wingetBase, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.equal(
    versionDirs.length,
    1,
    "Expected exactly one WinGet version directory",
  );
  const wingetDir = path.join(wingetBase, versionDirs[0]!);
  for (const name of [
    "OpenXBond.XBond.yaml",
    "OpenXBond.XBond.installer.yaml",
    "OpenXBond.XBond.locale.en-US.yaml",
  ]) {
    assert.ok(
      fs.existsSync(path.join(wingetDir, name)),
      `Missing WinGet manifest: ${name}`,
    );
  }
});
