import { execFileSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checksum, validateArchive } from "./artifact.ts";
import {
  androidAsset,
  cliAsset,
  desktopRelease,
  linuxPackageFormats,
  releaseTargets,
  releaseVersion,
} from "./release-version.ts";

const repo = "https://github.com/openxbond/xbond";

// The Pages deployment carries exactly these files; the deployment digest is
// sha256 over a sha256sum --binary listing of them (the "*name" marker is
// part of that listing format).
const PAGES_FILES = [
  "index.html",
  "download/index.html",
  "release.json",
  "desktop.json",
];

function pagesDigest(files: Map<string, Buffer>): string {
  const listing = PAGES_FILES.map(
    (name) =>
      `${createHash("sha256")
        .update(files.get(name) ?? Buffer.alloc(0))
        .digest("hex")} *${name}\n`,
  ).join("");
  return createHash("sha256").update(listing).digest("hex");
}

function verifyTauriSignature(
  file: string,
  signature: string,
  publicKey: string,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xbond-signature-"));
  const keyFile = path.join(dir, "key.pub");
  const signatureFile = path.join(dir, "asset.minisig");
  try {
    fs.writeFileSync(keyFile, Buffer.from(publicKey, "base64"));
    fs.writeFileSync(signatureFile, Buffer.from(signature, "base64"));
    execFileSync("minisign", [
      "-V",
      "-q",
      "-p",
      keyFile,
      "-x",
      signatureFile,
      "-m",
      file,
    ]);
  } finally {
    fs.unlinkSync(keyFile);
    fs.unlinkSync(signatureFile);
    fs.rmdirSync(dir);
  }
}

function putJSON(directory: string, name: string, data: unknown) {
  fs.writeFileSync(
    path.join(directory, name),
    JSON.stringify(data, null, 2) + "\n",
  );
}

function readAsset(directory: string, name: string) {
  const file = path.join(directory, name);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size === 0)
    throw new Error(`Invalid asset: ${name}`);
  return file;
}

export function assemble(
  directory: string,
  tag: string,
  notes: string,
  privateKeyPEM: string,
  expectedPublicKey: string,
) {
  const { version, build } = releaseVersion(tag);
  const key = createPrivateKey(privateKeyPEM);
  const publicKey = createPublicKey(key).export({ format: "jwk" });
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !publicKey.x ||
    Buffer.from(publicKey.x, "base64url").toString("base64") !==
      expectedPublicKey
  ) {
    throw new Error("The release key does not match XBOND_RELEASE_PUBLIC_KEY");
  }
  const assets: Record<string, { name: string; url: string; sha256: string }> =
    {};
  const fileNames = new Set<string>();
  function asset(id: string, name: string) {
    fileNames.add(name);
    return (assets[id] = {
      name,
      url: `${repo}/releases/download/${tag}/${name}`,
      sha256: checksum(readAsset(directory, name)),
    });
  }
  const platforms: Record<string, { url: string; signature: string }> = {};
  for (const [os, arch] of releaseTargets) {
    asset(`cli-${os}-${arch}`, cliAsset(tag, os, arch));
    const names = desktopRelease(tag, os, arch);
    const installer = asset(`desktop-${os}-${arch}`, names.installer);
    for (const { format, name } of names.packages) {
      asset(`desktop-${os}-${arch}-${format}`, name);
    }
    const updater =
      os === "darwin"
        ? asset(`updater-${os}-${arch}`, names.updater)
        : installer;
    const signatureName = updater.name + ".sig";
    const signature = fs
      .readFileSync(readAsset(directory, signatureName), "utf8")
      .trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature))
      throw new Error(`Invalid Tauri signature: ${signatureName}`);
    if (process.env.XBOND_TAURI_PUBLIC_KEY) {
      verifyTauriSignature(
        path.join(directory, updater.name),
        signature,
        process.env.XBOND_TAURI_PUBLIC_KEY,
      );
    }
    fileNames.add(signatureName);
    platforms[`${os}-${arch === "amd64" ? "x86_64" : "aarch64"}`] = {
      url: updater.url,
      signature,
    };
  }
  asset("android-universal", androidAsset(tag));
  asset("dashboard", "dashboard.zip");
  putJSON(directory, "desktop.json", { version, notes, platforms });
  asset("desktop-manifest", "desktop.json");
  asset("release-evidence", "release-evidence.json");
  const payload = Buffer.from(
    JSON.stringify({ version, build, notes, assets }),
  );
  putJSON(directory, "release.json", {
    payload: payload.toString("base64"),
    signature: sign(null, payload, key).toString("base64"),
  });
  fileNames.add("release.json");
  for (const name of fs.readdirSync(directory)) {
    if (!fileNames.has(name) && name !== "SHA256SUMS") {
      throw new Error(`Unexpected release asset: ${name}`);
    }
  }
  fs.writeFileSync(
    path.join(directory, "SHA256SUMS"),
    [...fileNames]
      .sort()
      .map((name) => `${checksum(path.join(directory, name))}  ${name}\n`)
      .join(""),
  );
}

function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

type ReleaseAsset = { name: string; url: string; sha256: string };

function readManifest(directory: string, tag: string, publicKey: string) {
  const { version, build } = releaseVersion(tag);
  const manifestPath = readAsset(directory, "release.json");
  const envelope = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey))
    throw new Error("Invalid release public key");
  const key = createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: Buffer.from(publicKey, "base64").toString("base64url"),
    },
    format: "jwk",
  });
  const payload = Buffer.from(envelope.payload, "base64");
  if (!verify(null, payload, key, Buffer.from(envelope.signature, "base64")))
    throw new Error("Invalid release manifest signature");
  const manifest: {
    assets: Record<string, ReleaseAsset>;
    notes: string;
    version: string;
    build: number;
  } = JSON.parse(payload.toString("utf8"));
  if (manifest.version !== version || manifest.build !== build)
    throw new Error("Release manifest version mismatch");
  for (const { name, url } of Object.values(manifest.assets)) {
    if (
      !/^[a-zA-Z0-9._-]+$/.test(name) ||
      url !== `${repo}/releases/download/${tag}/${name}`
    ) {
      throw new Error(`Release asset mismatch: ${name}`);
    }
  }
  return manifest;
}

export function verifyManifestAsset(
  directory: string,
  tag: string,
  id: string,
  publicKey: string,
) {
  const asset = readManifest(directory, tag, publicKey).assets[id];
  if (!asset || checksum(readAsset(directory, asset.name)) !== asset.sha256) {
    throw new Error(`Release asset mismatch: ${id}`);
  }
}

export function buildPages(
  directory: string,
  output: string,
  tag: string,
  storeLinks: string[],
  publicKey: string,
) {
  const { version, assets, notes } = readManifest(directory, tag, publicKey);
  const sums = fs.readFileSync(readAsset(directory, "SHA256SUMS"), "utf8");
  const checksums = new Map<string, string>();
  for (const line of sums.trimEnd().split("\n")) {
    const match = /^([a-f0-9]{64})  ([a-zA-Z0-9._-]+)$/.exec(line);
    if (
      !match ||
      checksums.has(match[2]) ||
      checksum(readAsset(directory, match[2])) !== match[1]
    ) {
      throw new Error(`Release checksum mismatch: ${line}`);
    }
    checksums.set(match[2], match[1]);
  }
  for (const { name, sha256 } of Object.values(assets)) {
    if (checksums.get(name) !== sha256)
      throw new Error(`Release asset mismatch: ${name}`);
  }
  validateArchive(path.join(directory, "dashboard.zip"), undefined, output);
  for (const name of ["release.json", "desktop.json", "SHA256SUMS"]) {
    fs.copyFileSync(path.join(directory, name), path.join(output, name));
  }
  const labels: Record<string, string> = {
    windows: "Windows",
    darwin: "macOS",
    linux: "Linux",
  };
  const platforms = Object.entries(labels)
    .map(([os, label]) => {
      const links = ["amd64", "arm64"]
        .map((arch) => {
          const desktop = assets[`desktop-${os}-${arch}`];
          const cli = assets[`cli-${os}-${arch}`];
          const nativePackages =
            os === "linux"
              ? linuxPackageFormats
                  .map((format) => {
                    const pkg = assets[`desktop-linux-${arch}-${format}`];
                    return pkg
                      ? `<a href="${escape(pkg.url)}">.${format}</a>`
                      : "";
                  })
                  .join("")
              : "";
          return `<li><strong>${arch === "amd64" ? "x64" : "ARM64"}</strong>${nativePackages}<a href="${escape(desktop.url)}">${os === "linux" ? "AppImage" : "Desktop installer"}</a><a href="${escape(cli.url)}">CLI binary</a></li>`;
        })
        .join("");
      return `<section><h2>${label}</h2><ul>${links}</ul></section>`;
    })
    .join("");
  const storeHosts = ["apps.apple.com", "testflight.apple.com"];
  const stores = ["App Store", "TestFlight"].map((label, index) => {
    const value = storeLinks[index]?.trim();
    if (!value) return "";
    const link = new URL(value);
    if (
      link.protocol !== "https:" ||
      link.host !== storeHosts[index] ||
      link.username ||
      link.password ||
      (label === "TestFlight" &&
        !/^\/join\/[a-zA-Z0-9]+\/?$/.test(link.pathname))
    )
      throw new Error(`Invalid ${label} URL`);
    return `<li><a href="${escape(link.href)}">${label}</a></li>`;
  });
  const iosInstall =
    stores[0] + stores[1] ||
    "<li>Contact the release maintainer for a TestFlight invitation.</li>";
  fs.mkdirSync(path.join(output, "download"), { recursive: true });
  fs.writeFileSync(
    path.join(output, "download/index.html"),
    `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Download XBond</title>
<style>
:root{color-scheme:light dark;--accent:#a24006;--line:#ddd;--bg:#faf9f7;--fg:#191714}
@media(prefers-color-scheme:dark){:root{--accent:#ffab70;--line:#413b35;--bg:#181613;--fg:#fbf6f0}}
body{margin:0;background:var(--bg);color:var(--fg);font:1rem/1.55 system-ui,sans-serif}
main{max-width:44rem;margin:auto;padding:2rem 1.25rem 4rem}
a{color:var(--accent);text-underline-offset:.2em}a:focus-visible{outline:2px solid;outline-offset:4px}
h1{font-size:2.5rem;line-height:1.15;margin:1.5rem 0 .5rem}h2{font-size:1.15rem;margin:0}
section{border-top:1px solid var(--line);padding:1.15rem 0}
ul{padding:0;margin:.5rem 0 0;list-style:none}li{display:flex;flex-wrap:wrap;gap:.25rem 1.25rem;padding:.25rem 0}
li strong{min-width:4rem}code{overflow-wrap:anywhere}
summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
</style>
<main><nav><a href="../">XBond Dashboard</a></nav><h1>Download XBond</h1>
<p>Version ${version}. Choose an installer or download the standalone CLI.</p>
${platforms}
<section><h2>Android and iOS</h2><ul><li><a href="${escape(assets["android-universal"].url)}">Android APK</a></li>${iosInstall}</ul></section>
<section><h2>Docker</h2><p><code>docker pull ghcr.io/openxbond/xbond:${tag}</code></p></section>
<section><h2>Release information</h2><ul><li><a href="${repo}/releases/tag/${tag}">GitHub Release</a><a href="../SHA256SUMS">SHA-256 checksums</a></li></ul>
<details><summary>Release notes</summary><pre>${escape(notes)}</pre></details></section></main></html>\n`,
  );
  const pages = new Map<string, Buffer>(
    PAGES_FILES.map((name) => [name, fs.readFileSync(path.join(output, name))]),
  );
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `pages_digest=${pagesDigest(pages)}\n`,
    );
}

async function pagesVerify(pagesUrl: string, tag: string, expected: string) {
  const base = pagesUrl.replace(/\/+$/, "");
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const files = new Map<string, Buffer>();
    try {
      for (const name of PAGES_FILES) {
        // Mirror the curl cache-buster: index pages are fetched as directories.
        const target = `${base}/${name.replace("index.html", "")}?v=${tag}`;
        const response = await fetch(target);
        if (!response.ok)
          throw new Error(`${target} returned ${response.status}`);
        files.set(name, Buffer.from(await response.arrayBuffer()));
      }
      if (pagesDigest(files) === expected) {
        console.log(`Pages serve the verified release (${expected})`);
        return;
      }
      throw new Error("the served digest differs from the deployment");
    } catch (error) {
      if (attempt === 6)
        throw new Error(
          `GitHub Pages did not serve the verified Dashboard, download page and both update feeds: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

const [command, tag, directory, argument, ...rest] = process.argv.slice(2);
if (command === "assemble") {
  if (!process.env.XBOND_TAURI_PUBLIC_KEY)
    throw new Error("Missing Tauri update public key");
  assemble(
    directory,
    tag,
    fs.readFileSync(argument, "utf8"),
    process.env.XBOND_RELEASE_PRIVATE_KEY ?? "",
    process.env.XBOND_RELEASE_PUBLIC_KEY ?? "",
  );
} else if (command === "pages")
  buildPages(
    directory,
    argument,
    tag,
    rest,
    process.env.XBOND_RELEASE_PUBLIC_KEY ?? "",
  );
else if (command === "pages-verify")
  await pagesVerify(directory, tag, argument ?? "");
else if (command === "verify")
  verifyManifestAsset(
    directory,
    tag,
    argument,
    process.env.XBOND_RELEASE_PUBLIC_KEY ?? "",
  );
else if (command) throw new Error(`Unknown release asset command: ${command}`);
