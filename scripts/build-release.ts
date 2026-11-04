import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checksum } from "./artifact.ts";
import { BUILD_TAGS } from "./go.ts";
import { cliAsset, releaseTargets, releaseVersion } from "./release-version.ts";

// Cross-builds the daemon binary matrix for a release and lays out the
// publish directory: one self-contained binary per target (the web UI and
// wintun.dll are embedded; wintun.dll extracts at runtime), a dashboard.zip
// from the shared release tooling, and SHA256SUMS over everything.
//
// Usage: node scripts/build-release.ts <vX.Y.Z>   (tag form v-prefixed)

const VERSION_PACKAGE = "github.com/openxbond/xbond/internal/version.Version";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { tag, version } = releaseVersion(process.argv[2] ?? "");
const publicKey = process.env.XBOND_RELEASE_PUBLIC_KEY ?? "";
if (publicKey && !/^[A-Za-z0-9+/]{43}=$/.test(publicKey)) {
  throw new Error("Expected a base64 Ed25519 release public key");
}

const outDir = path.join(root, "release", tag);
if (fs.existsSync(outDir))
  throw new Error(`Release directory already exists: ${outDir}`);

const web = spawnSync(
  process.execPath,
  [path.join(root, "node_modules", "vite", "bin", "vite.js"), "build"],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, XBOND_VERSION: version },
  },
);
if (web.status !== 0) process.exit(web.status ?? 1);

// The dashboard bundle rides the existing release tooling.
const packageResult = spawnSync(
  process.execPath,
  [
    path.join(root, "scripts", "artifact.ts"),
    "package",
    path.join(root, "dist"),
    outDir,
  ],
  { stdio: "inherit" },
);
if (packageResult.status !== 0) process.exit(packageResult.status ?? 1);

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
  if (res.status !== 0) process.exit(res.status ?? 1);
  checksums.push(`${checksum(out)}  ${name}`);
}

const dashboardZip = path.join(outDir, "dashboard.zip");
checksums.push(`${checksum(dashboardZip)}  dashboard.zip`);
fs.writeFileSync(path.join(outDir, "SHA256SUMS"), checksums.join("\n") + "\n");

for (const entry of fs.readdirSync(outDir)) {
  const stat = fs.statSync(path.join(outDir, entry));
  console.log(`${entry.padEnd(42)} ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
}
console.log(`\nrelease directory: release/${tag}`);
