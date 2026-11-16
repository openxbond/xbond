// Renders the release notes shown in the GitHub draft, the in-app update
// dialog and the download page. Commits are grouped by user impact through
// Conventional Commits; internal churn (chore/ci/docs/test/style/build) never
// reaches users, and hashes stay out of the body.
const repository = "https://github.com/openxbond/xbond";

const HIDDEN = new Set(["chore", "ci", "docs", "test", "style", "build"]);
const FEATURES = new Set(["feat"]);
const FIXES = new Set(["fix", "revert"]);
const IMPROVEMENTS = new Set(["perf", "refactor"]);

const SUBJECT = /^(\w+)(?:\(([^)]*)\))?(!)?: (.+)$/;

export interface ReleaseCommit {
  hash: string;
  type: string;
  scope?: string;
  subject: string;
  breaking: boolean;
}

export function parseCommits(log: string): ReleaseCommit[] {
  const commits: ReleaseCommit[] = [];
  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    const [hash, ...rest] = line.split("\t");
    const text = rest.join("\t").trim();
    if (!hash || !text) continue;
    const match = SUBJECT.exec(text);
    if (!match) {
      // A non-conventional subject is still a user-visible change.
      commits.push({ hash, type: "other", subject: text, breaking: false });
      continue;
    }
    commits.push({
      hash,
      type: match[1].toLowerCase(),
      scope: match[2] || undefined,
      subject: match[4],
      breaking: Boolean(match[3]),
    });
  }
  return commits;
}

function section(title: string, subjects: string[]): string {
  if (subjects.length === 0) return "";
  return `## ${title}\n\n${subjects.map((subject) => `- ${subject}`).join("\n")}\n`;
}

export function releaseNotes(options: {
  version: string;
  candidate: boolean;
  commits: ReleaseCommit[];
  previousTag?: string;
  compareRepository?: string;
}): string {
  const repositoryUrl = options.compareRepository ?? repository;
  const visible = options.commits.filter(
    (commit) => commit.breaking || !HIDDEN.has(commit.type),
  );
  const breaking = visible
    .filter((commit) => commit.breaking)
    .map((commit) => commit.subject);
  const features = visible
    .filter((commit) => !commit.breaking && FEATURES.has(commit.type))
    .map((commit) => commit.subject);
  const improvements = visible
    .filter((commit) => !commit.breaking && IMPROVEMENTS.has(commit.type))
    .map((commit) => commit.subject);
  const fixes = visible
    .filter((commit) => !commit.breaking && FIXES.has(commit.type))
    .map((commit) => commit.subject);
  const other = visible
    .filter(
      (commit) =>
        !commit.breaking &&
        !FEATURES.has(commit.type) &&
        !IMPROVEMENTS.has(commit.type) &&
        !FIXES.has(commit.type),
    )
    .map((commit) => commit.subject);

  const upgradeNotes = options.candidate
    ? [
        "此為候選版（RC），不會進入穩定更新通道；Android 需以相同簽名覆蓋安裝；桌面 RC 不會自動升級到同基線穩定版。",
        "This is a release candidate: it does not enter the stable update channel. Android requires the same signing key, and desktop candidates do not auto-upgrade to the stable build of the same base version.",
      ]
    : [
        "Android 覆蓋安裝需使用相同簽名；桌面、CLI 與 Android 可在應用內檢查更新。",
        "Android requires the same signing key for in-place updates; desktop, CLI and Android can check for updates in-app.",
      ];

  const body = [
    features.length ? section("新功能 / Features", features) : "",
    improvements.length ? section("改進 / Improvements", improvements) : "",
    fixes.length ? section("修復 / Fixes", fixes) : "",
    other.length ? section("其他變更 / Other changes", other) : "",
    breaking.length ? section("破壞性變更 / Breaking changes", breaking) : "",
    visible.length === 0
      ? "## 變更 / Changes\n\n- 本版以內部改進與穩定性修復為主。 / This release focuses on internal improvements and stability fixes.\n"
      : "",
    section("升級須知 / Upgrade notes", upgradeNotes),
  ]
    .filter(Boolean)
    .join("\n");

  const compare =
    options.previousTag &&
    `${repositoryUrl}/compare/${options.previousTag}...v${options.version}`;
  const changelog = compare
    ? `## 完整變更 / Full changelog\n\n${compare}\n`
    : "";

  return `# XBond ${options.version}\n\n${body}${changelog}`;
}
