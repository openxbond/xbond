import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

import { releaseVersion } from "./release-version.ts";

const [argument, ...extra] = process.argv.slice(2);
if (!argument || extra.length)
  throw new Error("Usage: pnpm release:image <vX.Y.Z>");
const { tag, version } = releaseVersion(argument);
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const release = join("release", tag);
const output = join(release, "oci");
if (existsSync(output))
  throw new Error(`Release directory already exists: ${output}`);
mkdirSync(release, { recursive: true });

const staging = mkdtempSync(join(release, ".oci-"));
try {
  const metadata = join(staging, "image.json");
  const archive = join(staging, `xbond-oci-${tag}.tar`);
  const result = spawnSync(
    "docker",
    [
      "buildx",
      "build",
      "--platform",
      "linux/amd64,linux/arm64",
      "--build-arg",
      `XBOND_VERSION=${version}`,
      "--label",
      `org.opencontainers.image.version=${tag}`,
      "--label",
      `org.opencontainers.image.revision=${commit}`,
      "--label",
      "org.opencontainers.image.source=https://github.com/openxbond/xbond",
      "--provenance=false",
      "--output",
      `type=oci,dest=${archive}`,
      "--metadata-file",
      metadata,
      ".",
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`docker buildx failed: ${result.status ?? result.signal}`);

  const digest: unknown = JSON.parse(readFileSync(metadata, "utf8"))[
    "containerimage.digest"
  ];
  if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(digest))
    throw new Error("Missing OCI image digest");
  if (!statSync(archive).size) throw new Error("Empty OCI archive");
  renameSync(staging, output);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `digest=${digest}\n`);
  console.log(`OCI image: ${output} (${digest})`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
