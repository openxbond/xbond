import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { releaseVersion } from "./release-version.ts";

type Release = { tag_name: string; draft: boolean; prerelease: boolean };

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
        "repos/openxbond/xbond/releases?per_page=100",
      ],
      { encoding: "utf8" },
    ),
  ).flat();
}

const [command, tag, argument] = process.argv.slice(2);
const { version, build } = releaseVersion(tag);
if (command === "preflight") {
  const commit = git("rev-parse", "--verify", `refs/tags/${tag}^{commit}`);
  git("merge-base", "--is-ancestor", commit, "refs/remotes/origin/main");
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
      (candidate.build === build && argument === "prepare")
    ) {
      throw new Error(`Release ${tag} must follow ${candidate.tag}`);
    }
    if (
      candidate.build < build &&
      (!previous || candidate.build > previous.build)
    )
      previous = candidate;
  }
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT ?? "",
    `tag=${tag}\nversion=${version}\nbuild=${build}\ncommit=${commit}\n`,
  );
  const log = git(
    "log",
    "--first-parent",
    "--format=- %s (%h)",
    previous ? `${previous.tag}..${commit}` : commit,
  );
  fs.writeFileSync("release-notes.md", `# XBond ${version}\n\n${log}\n`);
} else if (command === "evidence") {
  const commit = git("rev-parse", "HEAD");
  const run = process.env.GITHUB_RUN_ID;
  const digest = process.env.IMAGE_DIGEST ?? "";
  const iosSHA256 = process.env.IOS_SHA256 ?? "";
  if (
    !run ||
    !/^\d+$/.test(run) ||
    !/^sha256:[a-f0-9]{64}$/.test(digest) ||
    !/^[a-f0-9]{64}$/.test(iosSHA256)
  )
    throw new Error("Missing candidate evidence");
  fs.writeFileSync(
    path.join(argument, "release-evidence.json"),
    JSON.stringify({ tag, commit, run, digest, iosSHA256 }) + "\n",
  );
} else if (command === "verify-evidence") {
  const {
    tag: candidate,
    commit,
    run,
    digest,
    iosSHA256,
  } = JSON.parse(fs.readFileSync(argument, "utf8"));
  if (
    candidate !== tag ||
    commit !== git("rev-parse", `refs/tags/${tag}^{commit}`) ||
    !/^\d+$/.test(run) ||
    !/^sha256:[a-f0-9]{64}$/.test(digest) ||
    !/^[a-f0-9]{64}$/.test(iosSHA256)
  ) {
    throw new Error("Candidate evidence does not match the requested Tag");
  }
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT ?? "",
    `run=${run}\ndigest=${digest}\nios_sha256=${iosSHA256}\n`,
  );
} else {
  throw new Error(`Unknown release CI command: ${command}`);
}
