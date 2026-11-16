import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUILD_TAGS, VERSION_PACKAGE } from "../dev/go.ts";
import { packageDistribution } from "./artifact.ts";
import { releaseVersion, cliAsset } from "./release-version.ts";
import { releaseProblems } from "./version-rules.ts";

// A local, publish-free candidate: validates the version rules, then builds
// the web tree, dashboard.zip and the host CLI under release/<tag>/preview.
// It cannot catch native signing or bundling, but it turns the common version
// and packaging mistakes into a one-minute answer instead of a 30-minute CI
// round trip. `pnpm release:preview <vX.Y.Z[-rc.N]>`.

const repository = fileURLToPath(new URL("../..", import.meta.url));

const HOST_OS: Record<string, string> = {
  win32: "windows",
  darwin: "darwin",
  linux: "linux",
};
const HOST_ARCH: Record<string, string> = {
  x64: "amd64",
  arm64: "arm64",
};

function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: repository,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed: ${result.status ?? result.signal}`);
}

function main() {
  const [tag, ...extra] = process.argv.slice(2);
  if (!tag || extra.length)
    throw new Error("Usage: pnpm release:preview <vX.Y.Z[-rc.N]>");
  const { version } = releaseVersion(tag);
  const problems = releaseProblems(tag);
  if (problems.length) throw new Error(problems.join("\n"));

  const osName = HOST_OS[process.platform];
  const arch = HOST_ARCH[process.arch];
  if (!osName || !arch)
    throw new Error(
      `Unsupported preview host: ${process.platform}/${process.arch}`,
    );

  const output = path.join(repository, "release", tag, "preview");
  fs.rmSync(output, { recursive: true, force: true });
  const web = path.join(output, "web");
  const core = path.join(output, "core");
  fs.mkdirSync(core, { recursive: true });

  run(
    process.execPath,
    [
      path.join(repository, "node_modules", "vite", "bin", "vite.js"),
      "build",
      "--outDir",
      web,
    ],
    { XBOND_VERSION: version },
  );
  const digest = packageDistribution(web, core);

  const asset = cliAsset(tag, osName, arch);
  run(
    "go",
    [
      "build",
      "-tags",
      BUILD_TAGS,
      "-trimpath",
      "-ldflags",
      `-s -w -X ${VERSION_PACKAGE}=${version}`,
      "-o",
      path.join(core, asset),
      "./cmd/xbond",
    ],
    { CGO_ENABLED: "0", GOOS: osName, GOARCH: arch },
  );

  console.log(`
preview ${tag} (${osName}/${arch})
  web:          ${web}
  dashboard:    ${path.join(core, "dashboard.zip")} (${digest})
  cli:          ${path.join(core, asset)}
  candidates:   desktop, android and iOS need their native toolchains; run the
                matching pnpm release:* command or push the Tag for those.
`);
}

main();
