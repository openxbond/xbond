import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { releaseVariableProblems } from "./release-config.ts";
import { releaseVersion } from "./release-version.ts";

type Release = { tag_name: string; draft: boolean; prerelease: boolean };

// Release gates for the Actions workflows. Subcommands:
// - preflight <tag> <prepare|publish|store>  resolves the release commit,
//   enforces version ordering, and emits tag/version/build/commit plus the
//   derived mode and Apple signing flag. Raw event context arrives through
//   GITHUB_EVENT_NAME and RELEASE_MODE.
// - assemble <tag>                           signs the candidate and generates Pages.
// - verify-evidence <tag> <file>              re-validates evidence and emits
//   run/digest/ios_sha256 for cross-run artifact downloads.
// - require-artifact <run-id> <name>          fails with a clear message when
//   a prepare artifact is gone (90-day retention).

const repository = process.env.GITHUB_REPOSITORY ?? "openxbond/xbond";

export function releaseSettings(
  event: string | undefined,
  requested: string | undefined,
): { mode: "release" | "rehearsal"; appleSigning: boolean } {
  if (event === "push" || requested === "release") {
    return { mode: "release", appleSigning: true };
  }
  if (requested === "rehearsal" || requested === "rehearsal-with-apple") {
    return {
      mode: "rehearsal",
      appleSigning: requested === "rehearsal-with-apple",
    };
  }
  throw new Error("Expected release, rehearsal or rehearsal-with-apple.");
}

function git(...args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function releases(): Release[] {
  return JSON.parse(
    execFileSync(
      "gh",
      [
        "api",
        "--paginate",
        "--slurp",
        `repos/${repository}/releases?per_page=100`,
      ],
      { encoding: "utf8" },
    ),
  ).flat();
}

function writeOutputs(entries: Record<string, string>) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT ?? "",
    Object.entries(entries)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n") + "\n",
  );
}

function preflightContext(
  value: string | undefined,
): "prepare" | "publish" | "store" {
  if (value === "prepare" || value === "publish" || value === "store")
    return value;
  throw new Error("Expected preflight context: prepare, publish or store");
}

function preflight(tag: string, context: "prepare" | "publish" | "store") {
  const { version, build } = releaseVersion(tag);
  const ref = `refs/tags/${tag}`;
  const { mode, appleSigning } = releaseSettings(
    process.env.GITHUB_EVENT_NAME,
    context === "prepare" ? process.env.RELEASE_MODE : "release",
  );
  if (context === "prepare") {
    const problems = releaseVariableProblems(process.env, appleSigning);
    if (problems.length) throw new Error(problems.join("\n"));
  }
  const rehearsalWithoutTag =
    mode === "rehearsal" &&
    spawnSync("git", ["show-ref", "--verify", "--quiet", ref]).status === 1;
  const commit = git(
    "rev-parse",
    "--verify",
    `${rehearsalWithoutTag ? "HEAD" : ref}^{commit}`,
  );
  git("merge-base", "--is-ancestor", commit, "refs/remotes/origin/main");
  // The stores have independent release schedules. Verify their candidate
  // commit here, then let the store enforce its own version ordering.
  if (context === "store") process.exit(0);
  const list = releases();
  let previous: { tag: string; build: number } | undefined;
  for (const entry of list) {
    if (entry.draft || entry.prerelease) continue;
    let candidate;
    try {
      candidate = releaseVersion(entry.tag_name);
    } catch {
      continue;
    }
    if (
      candidate.build > build ||
      (candidate.build === build && context !== "publish")
    ) {
      throw new Error(`Release ${tag} must follow ${candidate.tag}`);
    }
    if (
      candidate.build < build &&
      (!previous || candidate.build > previous.build)
    )
      previous = candidate;
  }
  writeOutputs({
    tag,
    version,
    build: String(build),
    commit,
    mode,
    apple_signing: String(appleSigning),
  });
  const log = git(
    "log",
    "--first-parent",
    "--format=- %s (%h)",
    previous ? `${previous.tag}..${commit}` : commit,
  );
  fs.writeFileSync("release-notes.md", `# XBond ${version}\n\n${log}\n`);
}

function evidence(tag: string, directory: string) {
  const commit = git("rev-parse", "HEAD");
  const mode = process.env.RELEASE_MODE;
  const run = process.env.GITHUB_RUN_ID;
  const digest = process.env.IMAGE_DIGEST ?? "";
  const iosSHA256 = process.env.IOS_SHA256 ?? "";
  const partial = !iosSHA256 && mode === "rehearsal";
  if (
    (mode !== "release" && mode !== "rehearsal") ||
    !run ||
    !/^\d+$/.test(run) ||
    !/^sha256:[a-f0-9]{64}$/.test(digest) ||
    (!partial && !/^[a-f0-9]{64}$/.test(iosSHA256))
  )
    throw new Error("Missing candidate evidence");
  fs.writeFileSync(
    path.join(directory, "release-evidence.json"),
    JSON.stringify({ tag, commit, run, digest, iosSHA256, mode }) + "\n",
  );
}

function assembleCandidate(tag: string) {
  const { tag: validatedTag } = releaseVersion(tag);
  const release = path.join("release", validatedTag);
  const assets = path.join(release, "assets");
  const cli = fileURLToPath(new URL("./release-assets.ts", import.meta.url));
  evidence(validatedTag, assets);
  execFileSync(
    process.execPath,
    [cli, "assemble", validatedTag, assets, "release-notes.md"],
    { stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    [cli, "pages", validatedTag, assets, path.join(release, "pages")],
    { stdio: "inherit" },
  );
}

function verifyEvidence(tag: string, file: string) {
  const {
    tag: candidate,
    commit,
    run,
    digest,
    iosSHA256,
    mode,
  } = JSON.parse(fs.readFileSync(file, "utf8"));
  if (
    mode !== "release" ||
    candidate !== tag ||
    commit !== git("rev-parse", `refs/tags/${tag}^{commit}`) ||
    !/^\d+$/.test(run) ||
    !/^sha256:[a-f0-9]{64}$/.test(digest) ||
    !/^[a-f0-9]{64}$/.test(iosSHA256)
  ) {
    throw new Error(
      "Candidate evidence is not a complete release for the requested Tag",
    );
  }
  writeOutputs({
    run: String(run),
    digest,
    ios_sha256: iosSHA256,
  });
}

function requireArtifact(runId: string, name: string) {
  if (!/^\d+$/.test(runId))
    throw new Error("Expected the prepare run id from the release evidence");
  const list = JSON.parse(
    execFileSync(
      "gh",
      [
        "api",
        `repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`,
      ],
      { encoding: "utf8" },
    ),
  ) as { artifacts: { name: string; expired: boolean }[] };
  const artifact = list.artifacts.find((entry) => entry.name === name);
  if (!artifact || artifact.expired)
    throw new Error(
      `Artifact ${name} of prepare run ${runId} is missing or expired (retention is 90 days). Rerun Prepare XBond release for this tag.`,
    );
}

function main() {
  const [command, first, second] = process.argv.slice(2);
  if (command === "preflight") {
    if (first === undefined || first === "") throw new Error("Expected a tag");
    preflight(first, preflightContext(second));
  } else if (command === "assemble") assembleCandidate(first ?? "");
  else if (command === "verify-evidence") verifyEvidence(first, second);
  else if (command === "require-artifact") requireArtifact(first, second);
  else throw new Error(`Unknown release CI command: ${command}`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main();
}
