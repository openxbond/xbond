import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";

import { releaseVersion } from "./release-version.ts";

// Publishes and verifies the release OCI image on GHCR. Skopeo must be
// installed; GH_TOKEN authenticates the push. Subcommands:
// - check <tag> <digest>         present=true when GHCR already holds exactly
//                                the candidate digest, otherwise false
// - push <tag> <digest> <tar>    verifies the OCI archive against the digest
//                                and pushes it with digests preserved
// - verify-public <tag> <digest> [ref] checks the anonymous pull digest
// - promote <tag> <digest>       copies the verified version to latest

const image = (tag: string) => `docker://ghcr.io/openxbond/xbond:${tag}`;

function indexDigest(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function run(
  command: string,
  args: string[],
  options: { input?: string } = {},
) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input: options.input,
    stdio: options.input === undefined ? "inherit" : "pipe",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} failed: ${result.stderr?.toString() || result.stdout?.toString()}`,
    );
  return result.stdout;
}

function expectedPlatformArchitectures(bytes: Buffer): string[] {
  const index = JSON.parse(bytes.toString("utf8")) as {
    manifests: { platform?: { os?: string; architecture?: string } }[];
  };
  return index.manifests
    .map((entry) => entry.platform)
    .filter((platform) => platform?.os === "linux")
    .map((platform) => platform?.architecture ?? "")
    .sort();
}

function login() {
  if (!process.env.GH_TOKEN) throw new Error("Set GH_TOKEN for the GHCR login");
  run(
    "skopeo",
    [
      "login",
      "--username",
      process.env.GITHUB_ACTOR ?? "",
      "--password-stdin",
      "ghcr.io",
    ],
    { input: process.env.GH_TOKEN },
  );
}

function main() {
  const [command, tag, digest, argument] = process.argv.slice(2);
  if (!command || !tag || !digest)
    throw new Error(
      "Usage: node scripts/release/release-registry.ts <check|push|verify-public|promote> <vX.Y.Z> <sha256:...> [oci-archive.tar|latest]",
    );
  releaseVersion(tag);

  if (command === "check") {
    const result = spawnSync("skopeo", ["inspect", "--raw", image(tag)], {
      encoding: "buffer",
      stdio: "pipe",
    });
    if (result.status !== 0) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT ?? "", "present=false\n");
      return;
    }
    const actual = indexDigest(result.stdout);
    if (actual !== digest)
      throw new Error(
        `GHCR already holds a different image for ${tag}: ${actual} instead of ${digest}`,
      );
    fs.appendFileSync(process.env.GITHUB_OUTPUT ?? "", "present=true\n");
  } else if (command === "push") {
    if (!argument) throw new Error("Expected the path of the OCI archive");
    const source = `oci-archive:${argument}`;
    const bytes = execFileSync("skopeo", ["inspect", "--raw", source]);
    if (indexDigest(bytes) !== digest)
      throw new Error(
        "The OCI image index digest differs from the release evidence",
      );
    const architectures = expectedPlatformArchitectures(bytes);
    if (JSON.stringify(architectures) !== JSON.stringify(["amd64", "arm64"]))
      throw new Error(
        `Expected linux amd64 and arm64 images, found: ${architectures.join(", ") || "none"}`,
      );
    login();
    run("skopeo", ["copy", "--all", "--preserve-digests", source, image(tag)]);
  } else if (command === "promote") {
    const published = "docker://ghcr.io/openxbond/xbond@" + digest;
    login();
    run("skopeo", [
      "copy",
      "--all",
      "--preserve-digests",
      published,
      image("latest"),
    ]);
  } else if (command === "verify-public") {
    const result = spawnSync(
      "skopeo",
      [
        "inspect",
        "--no-creds",
        "--raw",
        image(argument === "latest" ? argument : tag),
      ],
      { encoding: "buffer", stdio: "pipe" },
    );
    if (result.status !== 0) {
      throw new Error(
        "The image is not publicly readable. Check the GHCR package visibility, then rerun this release.",
      );
    }
    const actual = indexDigest(result.stdout);
    if (actual !== digest)
      throw new Error(
        `The public GHCR digest ${actual} differs from the verified release ${digest}`,
      );
  } else {
    throw new Error(`Unknown release registry command: ${command}`);
  }
}

main();
