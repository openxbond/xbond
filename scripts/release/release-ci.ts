import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NOTE_LOCALES, parseCommits, releaseNotes } from "./notes.ts";
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
// - publish-candidate <tag>                   flips a verified vX.Y.Z-rc.N
//   draft to a public pre-release so the beta channel can resolve it; the
//   stable feeds, Pages and the latest image tag stay untouched.

const repository = process.env.GITHUB_REPOSITORY ?? "openxbond/xbond";

// Artifact families a prepare run can build. `all` keeps the complete matrix
// for stable candidates; a subset (for example `android,linux`) produces
// verification artifacts without a draft, which is how a quick candidate
// check avoids the full matrix.
export const releasePlatforms = [
  "core",
  "desktop",
  "android",
  "ios",
  "image",
] as const;

export function normalizePlatforms(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "all") return releasePlatforms.join(",");
  const requested = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const platform of requested)
    if (!(releasePlatforms as readonly string[]).includes(platform))
      throw new Error(
        `Unknown platform "${platform}"; expected ${releasePlatforms.join(", ")} or all`,
      );
  return [...new Set(["core", ...requested])].join(",");
}

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

const REQUIRED_NOTE_LOCALES = [
  "zh-hk",
  "en-us",
  "zh-cn",
  "ko",
  "fa",
  "ru",
] as const;

export function missingNoteLocales(
  notes: { locale: string }[] | undefined,
): string[] {
  return REQUIRED_NOTE_LOCALES.filter(
    (locale) => !notes?.some((note) => note.locale === locale),
  );
}

function releaseNoteFiles(
  commit: string,
  version: string,
): { locale: string; body: string }[] | undefined {
  const directory = `docs/releases/${version}`;
  const listing = spawnSync(
    "git",
    ["ls-tree", "--name-only", `${commit}:${directory}`],
    { encoding: "utf8" },
  );
  if (listing.status !== 0) return undefined;
  const notes: { locale: string; body: string }[] = [];
  for (const file of listing.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)) {
    if (!file.endsWith(".md")) continue;
    const locale = file.slice(0, -3);
    if (!(NOTE_LOCALES as readonly string[]).includes(locale)) {
      throw new Error(
        `Unknown release note locale "${locale}"; expected ${NOTE_LOCALES.join(", ")}`,
      );
    }
    const content = spawnSync(
      "git",
      ["show", `${commit}:${directory}/${file}`],
      { encoding: "utf8" },
    );
    if (content.status !== 0) continue;
    const body = content.stdout.trim();
    if (body) notes.push({ locale, body });
  }
  return notes.length ? notes : undefined;
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
  const { version, baseVersion, build, prerelease } = releaseVersion(tag);
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
  const notes = releaseNoteFiles(commit, baseVersion);
  if (!rehearsalWithoutTag) {
    const missing = missingNoteLocales(notes);
    if (missing.length) {
      throw new Error(
        `Release notes for ${baseVersion} must include ${missing
          .map((locale) => `docs/releases/${baseVersion}/${locale}.md`)
          .join(", ")}`,
      );
    }
    const firstParent = git(
      "rev-list",
      "--first-parent",
      "refs/remotes/origin/main",
    ).split("\n");
    if (!firstParent.includes(commit)) {
      throw new Error(`${tag} must point at a first-parent commit of main`);
    }
    const manifest = JSON.parse(git("show", `${commit}:package.json`)) as {
      version?: string;
    };
    if (manifest.version !== baseVersion) {
      throw new Error(
        `package.json at ${tag} has version ${manifest.version ?? "missing"}; expected ${baseVersion}`,
      );
    }
  }
  const list = releases();
  let previous: { tag: string; build: number } | undefined;
  for (const entry of list) {
    if (entry.draft) continue;
    let candidate;
    try {
      candidate = releaseVersion(entry.tag_name);
    } catch {
      continue;
    }
    const sameTag = candidate.tag === tag;
    if (!candidate.prerelease) {
      if (
        candidate.build > build ||
        (candidate.build === build && !(context === "publish" && sameTag))
      ) {
        throw new Error(`Release ${tag} must follow ${candidate.tag}`);
      }
      if (
        candidate.build < build &&
        (!previous || candidate.build > previous.build)
      )
        previous = candidate;
    } else if (!sameTag && candidate.build >= build) {
      // Another published prerelease already occupies this or a later build.
      throw new Error(`Release ${tag} must follow ${candidate.tag}`);
    }
  }
  if (context === "publish" && prerelease) {
    throw new Error(
      "Release candidates cannot be promoted as the stable release; publish a stable vX.Y.Z tag instead.",
    );
  }
  writeOutputs({
    tag,
    version,
    build: String(build),
    commit,
    mode,
    apple_signing: String(appleSigning),
    prerelease: String(prerelease),
    platforms: normalizePlatforms(process.env.RELEASE_PLATFORMS),
  });
  const log = notes
    ? ""
    : git(
        "log",
        "--first-parent",
        "--format=%h%x09%s",
        previous ? `${previous.tag}..${commit}` : commit,
      );
  fs.writeFileSync(
    "release-notes.md",
    releaseNotes({
      version,
      candidate: prerelease,
      commits: parseCommits(log),
      previousTag: previous?.tag,
      notes,
    }),
  );
}

function evidence(tag: string, directory: string) {
  const commit = git("rev-parse", "HEAD");
  const mode = process.env.RELEASE_MODE;
  const run = process.env.GITHUB_RUN_ID;
  const digest = process.env.IMAGE_DIGEST ?? "";
  const iosSHA256 = process.env.IOS_SHA256 ?? "";
  const { prerelease } = releaseVersion(tag);
  // A release may ship without an iOS archive when the distribution
  // credentials are not configured; an Apple-signed rehearsal must not.
  const iosRequired =
    mode === "rehearsal" && process.env.RELEASE_APPLE_SIGNING === "true";
  const iosValid = iosSHA256 === "" || /^[a-f0-9]{64}$/.test(iosSHA256);
  if (
    (mode !== "release" && mode !== "rehearsal") ||
    !run ||
    !/^\d+$/.test(run) ||
    !/^sha256:[a-f0-9]{64}$/.test(digest) ||
    !iosValid ||
    (iosRequired && !iosSHA256)
  )
    throw new Error("Missing candidate evidence");
  fs.writeFileSync(
    path.join(directory, "release-evidence.json"),
    JSON.stringify({ tag, commit, run, digest, iosSHA256, mode, prerelease }) +
      "\n",
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
    !/^(|[a-f0-9]{64})$/.test(iosSHA256)
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

// Flips a verified candidate draft to a public pre-release. Nothing else
// moves: the stable feeds, Pages and the latest image tag are untouched, so
// only an opted-in beta client resolves this release.
function publishCandidate(tag: string) {
  const { prerelease } = releaseVersion(tag);
  if (!prerelease)
    throw new Error(
      "publish-candidate publishes vX.Y.Z-rc.N candidates only; stable releases go through Publish XBond release",
    );
  const view = JSON.parse(
    execFileSync(
      "gh",
      ["release", "view", tag, "--json", "isDraft,isPrerelease"],
      { encoding: "utf8" },
    ),
  ) as { isDraft: boolean; isPrerelease: boolean };
  if (!view.isDraft)
    throw new Error(`${tag} is already published; use a new candidate Tag`);
  if (!view.isPrerelease)
    throw new Error(`${tag} is not marked as a pre-release`);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xbond-candidate-"));
  try {
    execFileSync(
      "gh",
      [
        "release",
        "download",
        tag,
        "--pattern",
        "release-evidence.json",
        "--dir",
        directory,
      ],
      { stdio: "inherit" },
    );
    verifyEvidence(tag, path.join(directory, "release-evidence.json"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  execFileSync("gh", ["release", "edit", tag, "--draft=false"], {
    stdio: "inherit",
  });
  console.log(
    `Published ${tag} as a public pre-release; the beta channel resolves it.`,
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
  else if (command === "publish-candidate") publishCandidate(first ?? "");
  else throw new Error(`Unknown release CI command: ${command}`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main();
}
