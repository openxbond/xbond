import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ANDROID_BUILD_TOOLS_VERSION } from "../dev/android-sdk.ts";
import { buildAndroidAPK } from "../dev/mobile.ts";
import { androidAsset, releaseVersion } from "./release-version.ts";

// Builds, signs and verifies the Android release APK.
//
// Env contract (the release-android-signing environment):
//   XBOND_RELEASE_PUBLIC_KEY  Ed25519 update manifest public key
//   ANDROID_HOME             Android SDK root with build-tools installed
//   ANDROID_KEYSTORE_BASE64  base64-encoded PKCS#12 keystore
//   ANDROID_STORE_PASSWORD   keystore password
//   ANDROID_KEY_PASSWORD     key password when different from the store password
//   ANDROID_KEY_ALIAS        signing key alias
//   ANDROID_SIGNER_SHA256    lowercase hex SHA-256 of the signing certificate
//
// Usage: pnpm release:android <vX.Y.Z>

const APPLICATION_ID = "net.xbond.app";
const MAX_APK_BYTES = 512 * 1024 * 1024;

export function parseSignerDigest(output: string): string | undefined {
  return /^Signer #1 certificate SHA-256 digest: ([a-f0-9]{64})$/m.exec(
    output,
  )?.[1];
}

export function parsePackageBadging(
  output: string,
): { name: string; versionCode: string; versionName: string } | undefined {
  const match =
    /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'(?: |$)/m.exec(
      output,
    );
  if (!match) return undefined;
  return { name: match[1], versionCode: match[2], versionName: match[3] };
}

function run(command: string, args: string[], env = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed: ${result.status ?? result.signal}`);
}

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0)
    throw new Error(
      `${command} failed: ${result.stderr?.toString() || result.stdout?.toString()}`,
    );
  return result.stdout;
}

function buildTools(): string {
  const home = process.env.ANDROID_HOME;
  if (!home) throw new Error("Set ANDROID_HOME to the Android SDK root");
  const directory = path.join(home, "build-tools", ANDROID_BUILD_TOOLS_VERSION);
  if (!fs.existsSync(directory))
    throw new Error(
      `Install Android SDK Build-Tools ${ANDROID_BUILD_TOOLS_VERSION}`,
    );
  return directory;
}

function main() {
  const [tag, ...extra] = process.argv.slice(2);
  if (!tag || extra.length)
    throw new Error("Usage: pnpm release:android <vX.Y.Z>");
  const { version, build } = releaseVersion(tag);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(process.env.XBOND_RELEASE_PUBLIC_KEY ?? ""))
    throw new Error(
      "Set XBOND_RELEASE_PUBLIC_KEY to the Ed25519 update manifest public key",
    );
  const directory = path.join("release", tag, "android");
  const keystore = process.env.ANDROID_KEYSTORE_BASE64;
  const storePassword = process.env.ANDROID_STORE_PASSWORD;
  const keyPassword = process.env.ANDROID_KEY_PASSWORD || storePassword;
  const keyAlias = process.env.ANDROID_KEY_ALIAS ?? "";
  const signerSha256 = process.env.ANDROID_SIGNER_SHA256 ?? "";
  if (!keystore || !storePassword || !keyPassword || !keyAlias)
    throw new Error(
      "Set ANDROID_KEYSTORE_BASE64, ANDROID_STORE_PASSWORD and ANDROID_KEY_ALIAS",
    );
  if (!/^[a-f0-9]{64}$/i.test(signerSha256))
    throw new Error(
      "Set ANDROID_SIGNER_SHA256 to the signing certificate digest",
    );
  const tools = buildTools();
  const unsigned = buildAndroidAPK({ release: { version, build } });
  const zipalign = path.join(tools, "zipalign");
  const apksigner = path.join(tools, "apksigner");
  const aapt = path.join(tools, "aapt");
  fs.mkdirSync(directory, { recursive: true });
  const output = path.join(directory, androidAsset(tag));

  const work = fs.mkdtempSync(path.join(directory, "xbond-apk-"));
  try {
    const keystoreFile = path.join(work, "keystore");
    const aligned = path.join(work, "aligned.apk");
    const signed = path.join(work, "signed.apk");
    fs.writeFileSync(keystoreFile, Buffer.from(keystore, "base64"));
    run(zipalign, ["-P", "16", "-f", "4", unsigned, aligned]);
    run(
      apksigner,
      [
        "sign",
        "--ks",
        keystoreFile,
        "--ks-key-alias",
        keyAlias,
        // apksigner reads these from its own environment, which this process
        // passes down unchanged.
        "--ks-pass",
        "env:ANDROID_STORE_PASSWORD",
        "--key-pass",
        "env:ANDROID_KEY_PASSWORD",
        "--out",
        signed,
        aligned,
      ],
      {
        ...process.env,
        ANDROID_STORE_PASSWORD: storePassword,
        ANDROID_KEY_PASSWORD: keyPassword,
      },
    );

    const bytes = fs.statSync(signed).size;
    if (bytes > MAX_APK_BYTES)
      throw new Error(
        `APK size ${bytes} bytes exceeds the Android updater's 512 MiB limit`,
      );

    const certificates = capture(apksigner, [
      "verify",
      "--print-certs",
      signed,
    ]);
    const digest = parseSignerDigest(certificates);
    if (!digest || digest !== signerSha256.toLowerCase())
      throw new Error(
        `The APK signing certificate does not match ANDROID_SIGNER_SHA256: ${digest ?? "none"}`,
      );

    const badging = capture(aapt, ["dump", "badging", signed]);
    const pkg = parsePackageBadging(badging);
    if (
      !pkg ||
      pkg.name !== APPLICATION_ID ||
      pkg.versionCode !== String(build) ||
      pkg.versionName !== version
    )
      throw new Error(
        `Unexpected APK identity: ${pkg ? JSON.stringify(pkg) : "no package entry"}`,
      );
    fs.renameSync(signed, output);
    console.log(
      `signed ${output}: ${pkg.name} ${pkg.versionName} (versionCode ${pkg.versionCode})`,
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main();
}
