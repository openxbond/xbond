import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const TYPES = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "test",
  "style",
  "build",
  "ci",
  "chore",
  "revert",
] as const;

const SCOPES = [
  "daemon",
  "engine",
  "sub",
  "client",
  "client-ui",
  "desktop",
  "mobile",
  "android",
  "ios",
  "release",
  "docker",
  "telemetry",
  "connect",
  "proxies",
  "settings",
  "logs",
  "auth",
  "repo",
  "docs",
  "ci",
  "build",
] as const;

const SUBJECT = /^([a-z]+)(?:\(([a-z0-9-]+)\))?(!)?: (.+)$/;
const BRANCH =
  /^(feat|fix|perf|refactor|docs|test|style|build|ci|chore|revert)\/[a-z0-9][a-z0-9.-]*$/;
const RELEASE_TITLE =
  /^chore\(release\): (0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const RELEASE_PREP_BRANCH =
  /^chore\/release-(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const CJK = /[\u3400-\u9fff]/;
const LATIN = /[A-Za-z]/;
const MAX_SUBJECT = 100;
const BOT_LOGIN = "xbond-automation[bot]";
const BLOCKED_IDENTITIES = [/hydrz/i, /n\.haoyuan@gmail\.com/i];

export function validateSubject(subject: string): string[] {
  const problems: string[] = [];
  if (subject !== subject.trim()) {
    problems.push("subject has leading or trailing whitespace");
  }
  if (subject.length > MAX_SUBJECT) {
    problems.push(
      `subject is ${subject.length} characters; max ${MAX_SUBJECT}`,
    );
  }
  const match = SUBJECT.exec(subject);
  if (!match) {
    return [
      ...problems,
      "expected `type(scope): English description` with an English type",
    ];
  }
  const [, type, scope, , description] = match;
  if (!(TYPES as readonly string[]).includes(type)) {
    problems.push(`type "${type}" is not allowed; use ${TYPES.join(", ")}`);
  }
  if (scope && !(SCOPES as readonly string[]).includes(scope)) {
    problems.push(`scope "${scope}" is not allowed; use ${SCOPES.join(", ")}`);
  }
  if (!description.trim()) problems.push("description is empty");
  const versionOnly =
    type === "chore" &&
    scope === "release" &&
    // GitHub appends " (#N)" to squash-merged subjects on main.
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)( \(#\d+\))?$/.test(
      description,
    );
  if (!versionOnly) {
    if (!LATIN.test(description) || CJK.test(description)) {
      problems.push(
        "description must be written in English and contain no Chinese characters",
      );
    }
    if (/[.。;；]$/.test(description)) {
      problems.push("description must not end with a period or semicolon");
    }
  }
  return problems;
}

export function validateCommitMessage(message: string): string[] {
  const lines = message
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();
  const [subject = "", ...body] = lines.split("\n");
  const problems = validateSubject(subject);
  if (
    SUBJECT.exec(subject)?.[3] &&
    !/^BREAKING CHANGE:/m.test(body.join("\n"))
  ) {
    problems.push("breaking change requires a BREAKING CHANGE: body line");
  }
  if (CJK.test(body.join("\n"))) {
    problems.push("commit message body must be written in English");
  }
  return problems;
}

export function validateCommitLog(log: string): string[] {
  const problems: string[] = [];
  for (const line of log.split("\n").filter(Boolean)) {
    const [
      hash,
      authorName,
      authorEmail,
      committerName,
      committerEmail,
      ...rest
    ] = line.split("\t");
    const subject = rest.join("\t");
    const blocked = [
      authorName,
      authorEmail,
      committerName,
      committerEmail,
    ].some((value) =>
      BLOCKED_IDENTITIES.some((pattern) => pattern.test(value ?? "")),
    );
    if (blocked) {
      problems.push(
        `${hash?.slice(0, 7)} ${subject} uses a blocked identity (${authorName} <${authorEmail}>)`,
      );
    }
  }
  return problems;
}

export interface PullRequestContext {
  base: string;
  head: string;
  title: string;
  actor: string;
}

export function validatePullRequest(pr: PullRequestContext): string[] {
  const problems = validateSubject(pr.title);
  if (pr.actor !== BOT_LOGIN) {
    problems.push(
      `PRs must be opened by ${BOT_LOGIN}, not "${pr.actor || "unknown"}"`,
    );
  }
  if (pr.base !== "main") {
    problems.push(`unsupported base branch "${pr.base}"; expected main`);
    return problems;
  }
  if (RELEASE_PREP_BRANCH.test(pr.head)) {
    if (!RELEASE_TITLE.test(pr.title)) {
      problems.push(
        "release prep PRs from `chore/release-X.Y.Z` must be titled `chore(release): X.Y.Z`",
      );
    }
    return problems;
  }
  if (!BRANCH.test(pr.head)) {
    problems.push(
      "PRs into main must come from `<type>/<slug>` with an allowed type",
    );
    return problems;
  }
  const branchType = pr.head.split("/")[0];
  const titleType = SUBJECT.exec(pr.title)?.[1];
  if (titleType !== branchType) {
    problems.push(
      `PR title type "${titleType ?? "none"}" must match branch prefix "${branchType}"`,
    );
  }
  return problems;
}

function report(problems: string[]): void {
  if (problems.length === 0) return;
  for (const problem of problems) console.error(`Policy: ${problem}`);
  process.exit(1);
}

function messageFile(file: string | undefined): void {
  if (!file) throw new Error("message mode needs a commit message file");
  report(validateCommitMessage(fs.readFileSync(file, "utf8")));
}

function pullRequest(file: string | undefined): void {
  const eventPath = file ?? process.env.GITHUB_EVENT_PATH;
  if (!eventPath)
    throw new Error("pr mode needs GITHUB_EVENT_PATH or a payload file");
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8")) as {
    pull_request?: {
      base?: { ref?: string };
      head?: { ref?: string };
      title?: string;
      user?: { login?: string };
    };
  };
  const pr = event.pull_request;
  if (!pr?.base?.ref || !pr.head?.ref || !pr.title) {
    console.log("Policy: no pull_request payload; nothing to check");
    return;
  }
  report(
    validatePullRequest({
      base: pr.base.ref,
      head: pr.head.ref,
      title: pr.title,
      actor: pr.user?.login ?? "",
    }),
  );
}

function commits(range: string | undefined): void {
  if (!range) throw new Error("commits mode needs a git range");
  const log = execFileSync(
    "git",
    ["log", "--format=%h%x09%an%x09%ae%x09%cn%x09%ce%x09%s", range],
    { encoding: "utf8" },
  );
  report(validateCommitLog(log));
}

function history(range: string): void {
  const log = execFileSync("git", ["log", "--format=%H%x1f%B%x1e", range], {
    encoding: "utf8",
  });
  const failures: string[] = [];
  for (const record of log.split("\x1e")) {
    const entry = record.trim();
    if (!entry) continue;
    const [hash, ...rest] = entry.split("\x1f");
    const message = rest.join("\x1f").trim();
    const problems = validateCommitMessage(message);
    if (problems.length) {
      const subject = message.split("\n")[0] ?? "";
      failures.push(
        `${hash?.slice(0, 7)} ${subject}\n${problems.map((p) => `  - ${p}`).join("\n")}`,
      );
    }
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
}

function main(): void {
  const [mode, argument] = process.argv.slice(2);
  try {
    switch (mode) {
      case "message":
        messageFile(argument);
        break;
      case "pr":
        pullRequest(argument);
        break;
      case "history":
        history(argument ?? "HEAD");
        break;
      case "commits":
        commits(argument);
        break;
      default:
        console.error(
          "Usage: check-git-policy.ts message <file> | pr [event.json] | commits <range> | history [range]",
        );
        process.exit(2);
    }
  } catch (error) {
    console.error(`Policy: ${(error as Error).message}`);
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
