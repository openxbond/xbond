import { spawnSync } from "node:child_process";
import {
  chmodSync,
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

import {
  buildDesktopBundle,
  desktopRustTarget,
} from "../dev/package-desktop.ts";
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

const root = fileURLToPath(new URL("../..", import.meta.url));
const tauriDirectory = join(root, "src-tauri");
const rustTarget = desktopRustTarget(releaseOS, arch);
const { bundle, extension, installer, updater, packages } = desktopRelease(
  tag,
  releaseOS,
  arch,
);
const releaseDirectory = join(root, "release", tag);
const cliDirectory = join(releaseDirectory, "core");
const output = join(releaseDirectory, "desktop", `${releaseOS}-${arch}`);
if (existsSync(output))
  throw new Error(`Release directory already exists: ${output}`);
const configDir = mkdtempSync(join(tmpdir(), "xbond-desktop-"));
const signingConfig = join(configDir, "tauri.signing.json");

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
  const versionMarker = folder === "rpm" ? `-${version}-` : `_${version}_`;
  const names = readdirSync(directory).filter(
    (name) =>
      name.endsWith(suffix) &&
      (suffix === ".app.tar.gz" || name.includes(versionMarker)),
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

try {
  // Notarization accepts an App Store Connect API key (ASC_KEY with its id and
  // issuer) or the legacy Apple ID credentials. The key is materialized into
  // the temporary config directory, which is removed in the finally block.
  const notaryKeyPath = join(configDir, "asc.p8");
  let notaryArgs: string[] | null = null;
  let notaryEnv: NodeJS.ProcessEnv = {};
  const notaryKey = os === "darwin" ? process.env.ASC_KEY : undefined;
  if (notaryKey) {
    const appleKeyID = process.env.ASC_KEY_ID;
    const appleIssuer = process.env.ASC_ISSUER_ID;
    if (appleKeyID && appleIssuer) {
      writeFileSync(notaryKeyPath, notaryKey, { mode: 0o600 });
      notaryArgs = [
        "--key",
        notaryKeyPath,
        "--key-id",
        appleKeyID,
        "--issuer",
        appleIssuer,
      ];
      // Tauri notarizes the .app before creating its updater archive.
      notaryEnv = {
        APPLE_API_KEY: appleKeyID,
        APPLE_API_ISSUER: appleIssuer,
        APPLE_API_KEY_PATH: notaryKeyPath,
      };
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

  writeFileSync(
    signingConfig,
    JSON.stringify({
      plugins: { updater: { pubkey: publicKey } },
      ...(os === "win32" && process.env.WINDOWS_CERTIFICATE_THUMBPRINT
        ? {
            bundle: {
              windows: {
                certificateThumbprint:
                  process.env.WINDOWS_CERTIFICATE_THUMBPRINT,
                digestAlgorithm: "sha256",
                timestampUrl:
                  process.env.WINDOWS_TIMESTAMP_URL ??
                  "http://timestamp.digicert.com",
                tsp: true,
              },
            },
          }
        : {}),
    }),
  );
  buildDesktopBundle({
    target: rustTarget,
    targetDirectory,
    version,
    prepareSidecar(destination) {
      copyFileSync(
        join(cliDirectory, cliAsset(tag, releaseOS, arch)),
        destination,
      );
      if (os !== "win32") chmodSync(destination, 0o755);
    },
    configs: [join(tauriDirectory, "tauri.release.conf.json"), signingConfig],
    env:
      os === "darwin" && macRehearsal
        ? { APPLE_SIGNING_IDENTITY: "-" }
        : notaryEnv,
  });

  mkdirSync(dirname(output), { recursive: true });
  const staging = mkdtempSync(join(dirname(output), ".bundle-"));
  try {
    copyBundle(staging, bundle, extension, installer, os !== "darwin");
    if (os === "win32") {
      run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(root, "scripts/release/verify-windows-signature.ps1"),
        join(staging, installer),
      ]);
    }
    for (const { format, name } of packages) {
      copyBundle(staging, format, `.${format}`, name, false);
    }
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
}
