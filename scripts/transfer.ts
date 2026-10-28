import {
  type SpawnSyncReturns,
  execFileSync,
  spawnSync,
} from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checksum, validateArchive, validateTag } from "./artifact.ts";

const TRANSIENT_MESSAGES = [
  "connection was reset",
  "connection reset",
  "recv failure",
  "failed to connect",
  "forcibly closed",
  "could not resolve",
  "timed out",
  "unexpected eof",
  "http 502",
  "http 503",
  "http 504",
  "empty reply",
  "remote end hung up",
];

function defaultSleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  spawnImpl?: typeof spawnSync;
  sleepImpl?: (ms: number) => void;
}

export function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): string {
  const spawnFn = options.spawnImpl ?? spawnSync;
  const sleepFn = options.sleepImpl ?? defaultSleepSync;

  for (let attempt = 0; attempt < 4; attempt++) {
    const result = spawnFn(command, args, {
      cwd: options.cwd,
      env: options.env,
      input: options.input,
      encoding: "utf8",
    }) as SpawnSyncReturns<string>;
    if (result.status === 0) {
      return (result.stdout ?? "").trim();
    }
    const stderrLower = (result.stderr ?? "").toLowerCase();
    const transient = TRANSIENT_MESSAGES.some((msg) =>
      stderrLower.includes(msg),
    );
    if (attempt === 3 || !transient) {
      if (result.stderr) {
        process.stderr.write(result.stderr);
      }
      throw new Error(
        `Command failed (${result.status}): ${command} ${args.join(" ")}`,
      );
    }
    sleepFn(1000 * 2 ** attempt);
  }
  throw new Error("Unreachable");
}

export function transfer(tag: string, directory: string): void {
  validateTag(tag);
  const repo = "openxbond/dashboard";
  const resolvedDir = path.resolve(directory);
  validateArchive(
    path.join(resolvedDir, "dashboard.zip"),
    path.join(resolvedDir, "SHA256SUMS"),
  );

  const token = process.env.GH_TOKEN;
  if (!token) {
    throw new Error("GH_TOKEN environment variable is required");
  }
  const auth = Buffer.from(`x-access-token:${token}`, "utf8").toString(
    "base64",
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "openxbond",
    GIT_AUTHOR_EMAIL: "no-reply@xbond.net",
    GIT_COMMITTER_NAME: "openxbond",
    GIT_COMMITTER_EMAIL: "no-reply@xbond.net",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}`,
  };

  const gitdir = fs.mkdtempSync(path.join(os.tmpdir(), "xbond-transfer-"));
  try {
    const git = (...args: string[]) => run("git", args, { cwd: gitdir, env });
    git("init", "-b", "artifacts");
    git("remote", "add", "origin", `https://github.com/${repo}.git`);

    const existing = git("ls-remote", "--tags", "origin", `refs/tags/${tag}`);
    let sha: string;
    if (existing) {
      sha = existing.split(/\s+/)[0]!;
      git("fetch", "origin", `refs/tags/${tag}`);
      const content = execFileSync("git", ["show", `${sha}:dashboard.zip`], {
        cwd: gitdir,
        env,
        maxBuffer: 256 * 1024 * 1024,
      });
      const publishedDigest = createHash("sha256")
        .update(content)
        .digest("hex");
      if (
        publishedDigest !== checksum(path.join(resolvedDir, "dashboard.zip"))
      ) {
        throw new Error(
          `Refusing to replace different published bytes for ${tag}`,
        );
      }
    } else {
      if (git("ls-remote", "--heads", "origin", "refs/heads/artifacts")) {
        git("fetch", "origin", "refs/heads/artifacts");
        git("checkout", "-B", "artifacts", "FETCH_HEAD");
      }
      for (const name of ["dashboard.zip", "SHA256SUMS"]) {
        fs.copyFileSync(path.join(resolvedDir, name), path.join(gitdir, name));
      }
      git("config", "user.name", "openxbond");
      git("config", "user.email", "no-reply@xbond.net");
      git("add", "dashboard.zip", "SHA256SUMS");
      git(
        "commit",
        "--allow-empty",
        "-m",
        `Publish compiled assets for ${tag}`,
      );
      sha = git("rev-parse", "HEAD");
      git("tag", tag);
      git(
        "push",
        "--atomic",
        "origin",
        "HEAD:refs/heads/artifacts",
        `refs/tags/${tag}`,
      );
    }

    const payload = JSON.stringify({
      event_type: "publish-artifact",
      client_payload: { tag, sha },
    });
    run(
      "gh",
      ["api", "--method", "POST", `repos/${repo}/dispatches`, "--input", "-"],
      {
        env,
        input: payload,
      },
    );
    console.log(`Transferred ${tag}: ${sha}`);
  } finally {
    fs.rmSync(gitdir, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [, , tag, directory] = process.argv;
  if (!tag || !directory) {
    throw new Error("Usage: transfer.ts <tag> <directory>");
  }
  transfer(tag, directory);
}
