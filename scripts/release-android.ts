import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { releaseVersion } from "./release-version.ts";

// Signs the Android release APK and verifies the pinned signing identity.
//
// Env contract (the release-android-signing environment):
//   ANDROID_HOME             Android SDK root with build-tools installed
//   KEYSTORE                 base64-encoded PKCS#12 keystore
//   ANDROID_STORE_PASSWORD   keystore password
//   ANDROID_KEY_PASSWORD     key password (workflow maps the override)
//   ANDROID_KEY_ALIAS        signing key alias
//   ANDROID_SIGNER_SHA256    lowercase hex SHA-256 of the signing certificate
//
// Usage: node scripts/release-android.ts sign <vX.Y.Z> <unsigned-apk> <output-apk>

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
    /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'$/m.exec(
      output,
    );
  if (!match) return undefined;
  return { name: match[1], versionCode: match[2], versionName: match[3] };
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
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
  const root = path.join(home, "build-tools");
  const versions = fs
    .readdirSync(root)
    .filter((name) => /^\d+(\.\d+)*$/.test(name))
    .sort((a, b) => {
      const [aParts, bParts] = [a, b].map((value) =>
        value.split(".").map(Number),
      );
      for (
        let index = 0;
        index < Math.max(aParts.length, bParts.length);
        index += 1
      ) {
        const delta = (bParts[index] ?? 0) - (aParts[index] ?? 0);
        if (delta !== 0) return delta;
      }
      return 0;
    });
  if (versions.length === 0)
    throw new Error(`No build-tools found under ${root}`);
  return path.join(root, versions[0]);
}

function main() {
  const [command, tag, unsigned, output] = process.argv.slice(2);
  if (command !== "sign" || !tag || !unsigned || !output)
    throw new Error(
      "Usage: node scripts/release-android.ts sign <vX.Y.Z> <unsigned-apk> <output-apk>",
    );
  const { version, build } = releaseVersion(tag);
  const keystore = process.env.KEYSTORE ?? "";
  const storePassword = process.env.ANDROID_STORE_PASSWORD ?? "";
  const keyPassword = process.env.ANDROID_KEY_PASSWORD ?? "";
  const keyAlias = process.env.ANDROID_KEY_ALIAS ?? "";
  const signerSha256 = process.env.ANDROID_SIGNER_SHA256 ?? "";
  if (!keystore || !storePassword || !keyPassword || !keyAlias)
    throw new Error(
      "Set KEYSTORE, ANDROID_STORE_PASSWORD, ANDROID_KEY_PASSWORD and ANDROID_KEY_ALIAS",
    );
  const tools = buildTools();
  const zipalign = path.join(tools, "zipalign");
  const apksigner = path.join(tools, "apksigner");
  const aapt = path.join(tools, "aapt");
  fs.mkdirSync(path.dirname(output), { recursive: true });

  const work = fs.mkdtempSync(path.join(path.dirname(output), "xbond-apk-"));
  try {
    const keystoreFile = path.join(work, "keystore");
    const aligned = path.join(work, "aligned.apk");
    fs.writeFileSync(keystoreFile, Buffer.from(keystore, "base64"));
    run(zipalign, ["-P", "16", "-f", "4", unsigned, aligned]);
    run(apksigner, [
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
      output,
      aligned,
    ]);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  const bytes = fs.statSync(output).size;
  if (bytes > MAX_APK_BYTES)
    throw new Error(
      `APK size ${bytes} bytes exceeds the Android updater's 512 MiB limit`,
    );

  const certificates = capture(apksigner, ["verify", "--print-certs", output]);
  const digest = parseSignerDigest(certificates);
  if (!digest || digest !== signerSha256.toLowerCase())
    throw new Error(
      `The APK signing certificate does not match ANDROID_SIGNER_SHA256: ${digest ?? "none"}`,
    );

  const badging = capture(aapt, ["dump", "badging", output]);
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
  console.log(
    `signed ${output}: ${pkg.name} ${pkg.versionName} (versionCode ${pkg.versionCode})`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main();
}
