import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Cross-builds the daemon binary matrix for a release and lays out the
// publish directory: one self-contained binary per target (the web UI and
// wintun.dll are embedded; wintun.dll extracts at runtime), a dashboard.zip
// from the shared release tooling, and SHA256SUMS over everything.
//
// Usage: node scripts/build-release.ts <vX.Y.Z>   (tag form v-prefixed)

const TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const BUILD_TAGS = "with_gvisor,with_quic,with_utls,with_clash_api";
const VERSION_PACKAGE = "github.com/openxbond/xbond/internal/version.Version";
const TARGETS: [string, string][] = [
  ["windows", "amd64"],
  ["windows", "arm64"],
  ["linux", "amd64"],
  ["linux", "arm64"],
  ["darwin", "amd64"],
  ["darwin", "arm64"],
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const tag = process.argv[2];
if (!tag || !TAG_PATTERN.test(tag)) {
  console.error(
    `Usage: node scripts/build-release.ts <vX.Y.Z> (got: ${tag ?? ""})`,
  );
  process.exit(1);
}

const outDir = path.join(root, "release", tag);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

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
for (const [osName, arch] of TARGETS) {
  const ext = osName === "windows" ? ".exe" : "";
  const name = `xbond-${tag}-${osName}-${arch}${ext}`;
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
      `-s -w -X ${VERSION_PACKAGE}=${tag}`,
      "-o",
      out,
      "./cmd/xbond",
    ],
    {
      stdio: "inherit",
      env: { ...process.env, CGO_ENABLED: "0", GOOS: osName, GOARCH: arch },
    },
  );
  if (res.status !== 0) process.exit(res.status ?? 1);
  const data = fs.readFileSync(out);
  checksums.push(`${createHash("sha256").update(data).digest("hex")}  ${name}`);
}

const dashboardZip = path.join(outDir, "dashboard.zip");
checksums.push(
  `${createHash("sha256").update(fs.readFileSync(dashboardZip)).digest("hex")}  dashboard.zip`,
);
fs.writeFileSync(path.join(outDir, "SHA256SUMS"), checksums.join("\n") + "\n");

for (const entry of fs.readdirSync(outDir)) {
  const stat = fs.statSync(path.join(outDir, entry));
  console.log(`${entry.padEnd(42)} ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
}
console.log(`\nrelease directory: release/${tag}`);
