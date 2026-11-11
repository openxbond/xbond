import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checksum, packageDistribution } from "./artifact.ts";
import { BUILD_TAGS } from "./go.ts";
import { cliAsset, releaseTargets, releaseVersion } from "./release-version.ts";

// Cross-builds the daemon binary matrix for a release and lays out the
// release directory: the compiled web tree, standalone CLI binaries,
// dashboard.zip and their checksums.
//
// Usage: node scripts/build-release.ts <vX.Y.Z>   (tag form v-prefixed)

const VERSION_PACKAGE = "github.com/openxbond/xbond/internal/version.Version";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { tag, version } = releaseVersion(process.argv[2] ?? "");
const publicKey = process.env.XBOND_RELEASE_PUBLIC_KEY ?? "";
if (publicKey && !/^[A-Za-z0-9+/]{43}=$/.test(publicKey)) {
  throw new Error("Expected a base64 Ed25519 release public key");
}

const releaseRoot = path.join(root, "release");
const releaseDirectory = path.join(releaseRoot, tag);
if (fs.existsSync(releaseDirectory))
  throw new Error(`Release directory already exists: ${releaseDirectory}`);

fs.mkdirSync(releaseRoot, { recursive: true });
const staging = fs.mkdtempSync(path.join(releaseRoot, `.${tag}-`));
try {
  buildRelease(staging);
  fs.renameSync(staging, releaseDirectory);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
console.log(`\nrelease directory: ${releaseDirectory}`);

function buildRelease(staging: string) {
  const webDir = path.join(staging, "web");
  const outDir = path.join(staging, "core");
  const web = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules", "vite", "bin", "vite.js"),
      "build",
      "--outDir",
      webDir,
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, XBOND_VERSION: version },
    },
  );
  if (web.error) throw web.error;
  if (web.status !== 0) throw new Error("Dashboard build failed");

  packageDistribution(webDir, outDir);
  const checksums: string[] = [];
  for (const [osName, arch] of releaseTargets) {
    const name = cliAsset(tag, osName, arch);
    const out = path.join(outDir, name);
    console.log(`building ${name} ...`);
    const res = spawnSync(
      "go",
      [
        "build",
        "-tags",
        BUILD_TAGS,
        "-trimpath",
        "-ldflags",
        `-s -w -X ${VERSION_PACKAGE}=${version} -X ${VERSION_PACKAGE.replace(".Version", ".ReleasePublicKey")}=${publicKey}`,
        "-o",
        out,
        "./cmd/xbond",
      ],
      {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, CGO_ENABLED: "0", GOOS: osName, GOARCH: arch },
      },
    );
    if (res.error) throw res.error;
    if (res.status !== 0) throw new Error(`Build failed: ${name}`);
    checksums.push(`${checksum(out)}  ${name}`);
  }

  // The host binary must report exactly the version it was built for; this is
  // the release smoke check that used to live in the workflow.
  const hostOS = process.platform === "win32" ? "windows" : process.platform;
  const hostArch =
    process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : "";
  if (releaseTargets.some(([os, arch]) => os === hostOS && arch === hostArch)) {
    const info = JSON.parse(
      execFileSync(
        path.join(outDir, cliAsset(tag, hostOS, hostArch)),
        ["version", "--json"],
        {
          encoding: "utf8",
        },
      ),
    ) as { clientVersion: string; os: string; arch: string };
    if (
      info.clientVersion !== version ||
      info.os !== hostOS ||
      info.arch !== hostArch
    )
      throw new Error(`Host CLI smoke check mismatch: ${JSON.stringify(info)}`);
    console.log(
      `smoke check ok: ${hostOS}-${hostArch} reports ${info.clientVersion}`,
    );
  }

  const dashboardZip = path.join(outDir, "dashboard.zip");
  checksums.push(`${checksum(dashboardZip)}  dashboard.zip`);
  fs.writeFileSync(
    path.join(outDir, "SHA256SUMS"),
    checksums.join("\n") + "\n",
  );

  for (const entry of fs.readdirSync(outDir)) {
    const stat = fs.statSync(path.join(outDir, entry));
    console.log(
      `${entry.padEnd(42)} ${(stat.size / 1024 / 1024).toFixed(1)} MB`,
    );
  }
}
