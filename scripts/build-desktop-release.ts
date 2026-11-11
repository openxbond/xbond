import { spawnSync } from "node:child_process";
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliAsset, desktopRelease, releaseVersion } from "./release-version.ts";

const [tag, releaseOS, arch] = process.argv.slice(2);
const { version } = releaseVersion(tag);
const os = releaseOS === "windows" ? "win32" : releaseOS;
if (
  os !== process.platform ||
  (releaseOS !== "windows" &&
    releaseOS !== "darwin" &&
    releaseOS !== "linux") ||
  (arch !== "amd64" && arch !== "arm64")
) {
  throw new Error(
    "Usage: pnpm release:desktop <vX.Y.Z> <windows|darwin|linux> <amd64|arm64> (on the matching OS)",
  );
}

const publicKey = process.env.XBOND_TAURI_PUBLIC_KEY?.trim();
if (!publicKey || !process.env.TAURI_SIGNING_PRIVATE_KEY) {
  throw new Error("Set XBOND_TAURI_PUBLIC_KEY and TAURI_SIGNING_PRIVATE_KEY");
}
const macIdentity = process.env.APPLE_SIGNING_IDENTITY;
const macRehearsal = process.env.XBOND_DESKTOP_REHEARSAL === "1";
const appleID = process.env.APPLE_ID;
const applePassword = process.env.APPLE_PASSWORD;
const appleTeam = process.env.APPLE_TEAM_ID;

const root = fileURLToPath(new URL("..", import.meta.url));
const tauriDirectory = join(root, "apps", "desktop", "src-tauri");
const rustOS =
  os === "win32"
    ? "pc-windows-msvc"
    : os === "darwin"
      ? "apple-darwin"
      : "unknown-linux-gnu";
const rustTarget = `${arch === "amd64" ? "x86_64" : "aarch64"}-${rustOS}`;
const { bundle, extension, installer, updater } = desktopRelease(
  tag,
  releaseOS,
  arch,
);
const exeExtension = os === "win32" ? ".exe" : "";
const sidecar = join(
  tauriDirectory,
  "binaries",
  `xbond-daemon-${rustTarget}${exeExtension}`,
);
const releaseDirectory = join(root, "release", tag);
const cliDirectory = join(releaseDirectory, "core");
const output = join(releaseDirectory, "desktop", `${releaseOS}-${arch}`);
if (existsSync(output))
  throw new Error(`Release directory already exists: ${output}`);
const configDir = mkdtempSync(join(tmpdir(), "xbond-desktop-"));
const config = join(configDir, "tauri.release.json");

const targetDirectory = resolve(
  process.env.CARGO_TARGET_DIR ?? join(tauriDirectory, "target"),
);
const bundleDirectory = join(targetDirectory, rustTarget, "release", "bundle");

function copyBundle(
  staging: string,
  folder: string,
  suffix: string,
  name: string,
  signed: boolean,
) {
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
  copyFileSync(source, join(staging, name));
  if (signed) {
    const signature = source + ".sig";
    if (statSync(signature).size === 0)
      throw new Error(`Empty signature: ${signature}`);
    copyFileSync(signature, join(staging, name + ".sig"));
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
  // Notarization accepts an App Store Connect API key (ASC_KEY with its id and
  // issuer) or the legacy Apple ID credentials. The key is materialized into
  // the temporary config directory, which is removed in the finally block.
  const notaryKeyPath = join(configDir, "asc.p8");
  let notaryArgs: string[] | null = null;
  if (os === "darwin" && process.env.ASC_KEY) {
    const appleKeyID = process.env.ASC_KEY_ID;
    const appleIssuer = process.env.ASC_ISSUER_ID;
    if (appleKeyID && appleIssuer) {
      writeFileSync(notaryKeyPath, process.env.ASC_KEY, { mode: 0o600 });
      notaryArgs = [
        "--key",
        notaryKeyPath,
        "--key-id",
        appleKeyID,
        "--issuer",
        appleIssuer,
      ];
    }
  } else if (appleID && applePassword && appleTeam) {
    notaryArgs = [
      "--apple-id",
      appleID,
      "--password",
      applePassword,
      "--team-id",
      appleTeam,
    ];
  }
  if (
    os === "darwin" &&
    !macRehearsal &&
    (!macIdentity || macIdentity === "-" || !notaryArgs)
  ) {
    throw new Error(
      "Set APPLE_SIGNING_IDENTITY and Apple notarization credentials for a macOS release",
    );
  }

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

  mkdirSync(dirname(output), { recursive: true });
  const staging = mkdtempSync(join(dirname(output), ".bundle-"));
  try {
    copyBundle(staging, bundle, extension, installer, os !== "darwin");
    if (os === "darwin") {
      copyBundle(staging, "macos", ".app.tar.gz", updater, true);
      if (!macRehearsal && macIdentity && notaryArgs) {
        const dmg = join(staging, installer);
        // Tauri signs the DMG while its temporary signing keychain is open.
        run("codesign", ["--verify", "--strict", dmg]);
        run("xcrun", ["notarytool", "submit", dmg, "--wait", ...notaryArgs]);
        run("xcrun", ["stapler", "staple", dmg]);
        run("xcrun", ["stapler", "validate", dmg]);
      }
    }
    renameSync(staging, output);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
} finally {
  rmSync(configDir, { recursive: true, force: true });
  if (copiedSidecar) rmSync(sidecar);
}
