import { spawnSync } from "node:child_process";
import {
  chmodSync,
  constants,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliAsset, releaseVersion } from "./release-version.ts";

const [tag, releaseOS, arch, cliDirectory, outputDirectory] =
  process.argv.slice(2);
const { version } = releaseVersion(tag);
const os = releaseOS === "windows" ? "win32" : releaseOS;
if (
  os !== process.platform ||
  (os !== "win32" && os !== "darwin" && os !== "linux") ||
  (arch !== "amd64" && arch !== "arm64") ||
  !cliDirectory ||
  !outputDirectory
) {
  throw new Error(
    "Expected a release tag, matching runner OS, amd64/arm64, CLI asset directory and output directory",
  );
}

const publicKey = process.env.XBOND_TAURI_PUBLIC_KEY?.trim();
if (!publicKey || !process.env.TAURI_SIGNING_PRIVATE_KEY) {
  throw new Error("Set XBOND_TAURI_PUBLIC_KEY and TAURI_SIGNING_PRIVATE_KEY");
}
const macIdentity = process.env.APPLE_SIGNING_IDENTITY;
const macRehearsal = process.env.XBOND_DESKTOP_REHEARSAL === "1";
const appleKey = process.env.APPLE_API_KEY_PATH;
const appleKeyID = process.env.APPLE_API_KEY;
const appleIssuer = process.env.APPLE_API_ISSUER;
const appleID = process.env.APPLE_ID;
const applePassword = process.env.APPLE_PASSWORD;
const appleTeam = process.env.APPLE_TEAM_ID;
const notaryArgs =
  appleKey && appleKeyID && appleIssuer
    ? ["--key", appleKey, "--key-id", appleKeyID, "--issuer", appleIssuer]
    : appleID && applePassword && appleTeam
      ? [
          "--apple-id",
          appleID,
          "--password",
          applePassword,
          "--team-id",
          appleTeam,
        ]
      : null;
if (
  os === "darwin" &&
  !macRehearsal &&
  (!macIdentity || macIdentity === "-" || !notaryArgs)
) {
  throw new Error(
    "Set APPLE_SIGNING_IDENTITY and Apple notarization credentials for a macOS release",
  );
}

const root = fileURLToPath(new URL("..", import.meta.url));
const tauriDirectory = join(root, "apps", "desktop", "src-tauri");
const rustOS =
  os === "win32"
    ? "pc-windows-msvc"
    : os === "darwin"
      ? "apple-darwin"
      : "unknown-linux-gnu";
const rustTarget = `${arch === "amd64" ? "x86_64" : "aarch64"}-${rustOS}`;
const bundle = os === "win32" ? "nsis" : os === "darwin" ? "dmg" : "appimage";
const extension =
  os === "win32" ? ".exe" : os === "darwin" ? ".dmg" : ".AppImage";
const exeExtension = os === "win32" ? ".exe" : "";
const sidecar = join(
  tauriDirectory,
  "binaries",
  `xbond-daemon-${rustTarget}${exeExtension}`,
);
const output = resolve(outputDirectory);
const prefix = `xbond-desktop-${tag}-${releaseOS}-${arch}`;
const configDir = mkdtempSync(join(tmpdir(), "xbond-desktop-"));
const config = join(configDir, "tauri.release.json");
const targetDirectory = resolve(
  process.env.CARGO_TARGET_DIR ?? join(tauriDirectory, "target"),
);
const bundleDirectory = join(targetDirectory, rustTarget, "release", "bundle");

function copyBundle(folder: string, suffix: string, signed: boolean) {
  const directory = join(bundleDirectory, folder);
  const names = readdirSync(directory).filter(
    (name) =>
      name.endsWith(suffix) &&
      (suffix === ".app.tar.gz" || name.includes(`_${version}_`)),
  );
  if (names.length !== 1) {
    throw new Error(`Expected exactly one ${suffix} artifact in ${directory}`);
  }
  const source = join(directory, names[0]);
  if (statSync(source).size === 0) throw new Error(`Empty artifact: ${source}`);
  copyFileSync(source, join(output, prefix + suffix));
  if (signed) {
    const signature = source + ".sig";
    if (statSync(signature).size === 0)
      throw new Error(`Empty signature: ${signature}`);
    copyFileSync(signature, join(output, prefix + suffix + ".sig"));
  }
}

function run(command: string, args: string[], env = process.env) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.status ?? result.signal}`);
  }
}

let copiedSidecar = false;
try {
  mkdirSync(join(tauriDirectory, "binaries"), { recursive: true });
  copyFileSync(
    join(cliDirectory, cliAsset(tag, releaseOS, arch)),
    sidecar,
    constants.COPYFILE_EXCL,
  );
  copiedSidecar = true;
  if (os !== "win32") chmodSync(sidecar, 0o755);
  writeFileSync(
    config,
    JSON.stringify({
      version,
      bundle: {
        createUpdaterArtifacts: true,
        externalBin: ["binaries/xbond-daemon"],
        ...(os === "win32" && process.env.WINDOWS_CERTIFICATE_THUMBPRINT
          ? {
              windows: {
                certificateThumbprint:
                  process.env.WINDOWS_CERTIFICATE_THUMBPRINT,
                digestAlgorithm: "sha256",
                timestampUrl:
                  process.env.WINDOWS_TIMESTAMP_URL ??
                  "http://timestamp.digicert.com",
                tsp: true,
              },
            }
          : {}),
      },
      plugins: {
        updater: {
          pubkey: publicKey,
          requireSignedVersion: true,
          endpoints: ["https://openxbond.github.io/xbond/desktop.json"],
        },
      },
    }),
  );
  run(
    process.execPath,
    [
      join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"),
      "build",
      "--config",
      config,
      "--target",
      rustTarget,
      "--bundles",
      os === "darwin" ? "app,dmg" : bundle,
    ],
    {
      ...process.env,
      CARGO_TARGET_DIR: targetDirectory,
      XBOND_VERSION: version,
      XBOND_DESKTOP_RELEASE: "1",
      ...(os === "darwin" && macRehearsal
        ? { APPLE_SIGNING_IDENTITY: "-" }
        : {}),
    },
  );

  mkdirSync(output, { recursive: true });
  copyBundle(bundle, extension, os !== "darwin");
  if (os === "darwin") {
    copyBundle("macos", ".app.tar.gz", true);
    if (!macRehearsal && macIdentity && notaryArgs) {
      const dmg = join(output, prefix + extension);
      // Tauri signs the DMG while its temporary signing keychain is open.
      run("codesign", ["--verify", "--strict", dmg]);
      run("xcrun", ["notarytool", "submit", dmg, "--wait", ...notaryArgs]);
      run("xcrun", ["stapler", "staple", dmg]);
      run("xcrun", ["stapler", "validate", dmg]);
    }
  }
} finally {
  rmSync(config, { force: true });
  rmdirSync(configDir);
  if (copiedSidecar) rmSync(sidecar);
}
