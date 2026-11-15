import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import { checksum } from "./artifact.ts";
import { releaseVersion } from "./release-version.ts";

const [tag, ...extra] = process.argv.slice(2);
if (!tag || extra.length) throw new Error("Usage: pnpm release:ios <vX.Y.Z>");
const { version, build } = releaseVersion(tag);
if (process.platform !== "darwin")
  throw new Error("iOS packaging requires macOS");

// Apple rejects prerelease marketing versions, so an rc.N candidate ships the
// stable marketing version and separates itself through the build number.
const marketingVersion = version.replace(/-rc\.[0-9]+$/, "");

const result = spawnSync(
  "bash",
  ["scripts/release/release-ios.sh", "archive", `release/${tag}/ios`],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      XBOND_VERSION: marketingVersion,
      XBOND_RELEASE_TAG: tag,
      XBOND_BUILD_NUMBER: String(build),
    },
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const sha256 = checksum(`release/${tag}/ios/xbond-ios-${tag}.ipa`);
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `sha256=${sha256}\n`);
