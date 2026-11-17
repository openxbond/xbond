import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function releaseVariableProblems(
  vars: Readonly<Record<string, string | undefined>>,
  appleSigning: boolean,
): string[] {
  const problems: string[] = [];
  const manifestKey = vars.XBOND_RELEASE_PUBLIC_KEY ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(manifestKey)) {
    problems.push(
      "XBOND_RELEASE_PUBLIC_KEY must be a raw 32-byte Ed25519 public key in Base64.",
    );
  }

  const updaterKey = vars.XBOND_TAURI_PUBLIC_KEY?.trim() ?? "";
  const [comment, payload] = Buffer.from(updaterKey, "base64")
    .toString("utf8")
    .trim()
    .split(/\r?\n/);
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(updaterKey) ||
    !comment.startsWith("untrusted comment: ") ||
    !/^RW[A-Za-z0-9+/]{54}$/.test(payload ?? "")
  ) {
    problems.push(
      "XBOND_TAURI_PUBLIC_KEY must be the content of the Tauri signer .pub file.",
    );
  }

  if (!vars.ANDROID_KEY_ALIAS?.trim())
    problems.push("Missing ANDROID_KEY_ALIAS.");
  const androidSigner = vars.ANDROID_SIGNER_SHA256 ?? "";
  if (!/^[0-9a-f]{64}$/.test(androidSigner)) {
    problems.push(
      "ANDROID_SIGNER_SHA256 must be 64 lowercase hex characters without colons.",
    );
  }
  if (appleSigning) {
    for (const name of ["APPLE_TEAM_ID", "APPLE_SIGNING_IDENTITY"]) {
      if (!vars[name]?.trim()) problems.push(`Missing ${name}.`);
    }
  }
  return problems;
}

function ghList<T>(args: string[]): T[] {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8" }));
}

function ghJson<T>(args: string[]): T {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8" })) as T;
}

type DeploymentPolicy = { name: string; type: string };

// Every environment that guards release secrets or deployments must keep
// typed deployment policies: tag pushes are rejected by branch-only rules,
// so the tag pattern needs `type: "tag"` (see docs/release.md).
export const expectedDeploymentPolicies: Record<string, DeploymentPolicy[]> = {
  "release-manifest-signing": [
    { name: "main", type: "branch" },
    { name: "v*", type: "tag" },
  ],
  "release-desktop-signing": [
    { name: "main", type: "branch" },
    { name: "v*", type: "tag" },
  ],
  "release-android-signing": [
    { name: "main", type: "branch" },
    { name: "v*", type: "tag" },
  ],
  "release-ios-signing": [
    { name: "main", type: "branch" },
    { name: "v*", type: "tag" },
  ],
  "release-store-ios": [
    { name: "main", type: "branch" },
    { name: "v*", type: "tag" },
  ],
  "release-production": [{ name: "main", type: "branch" }],
  "github-pages": [{ name: "main", type: "branch" }],
};

export function releasePolicyProblems(
  live: Readonly<Record<string, DeploymentPolicy[] | undefined>>,
): string[] {
  const problems: string[] = [];
  for (const [environment, expected] of Object.entries(
    expectedDeploymentPolicies,
  )) {
    const actual = live[environment];
    if (!actual) {
      problems.push(
        `Environment "${environment}" is missing or has no typed deployment policies.`,
      );
      continue;
    }
    const signature = (list: DeploymentPolicy[]) =>
      list
        .map((p) => `${p.name}:${p.type}`)
        .sort()
        .join(", ");
    const want = signature(expected);
    const have = signature(actual);
    if (want !== have) {
      problems.push(
        `Environment "${environment}" deployment policies must be ${want}; found ${have}.`,
      );
    }
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--rehearsal")) {
    throw new Error("Usage: pnpm release:check [--rehearsal]");
  }

  const repository = "openxbond/xbond";
  const appleSigning = args.length === 0;
  const variables = Object.fromEntries(
    ghList<{ name: string; value: string }>([
      "variable",
      "list",
      "--repo",
      repository,
      "--json",
      "name,value",
    ]).map(({ name, value }) => [name, value]),
  );
  const problems = releaseVariableProblems(variables, appleSigning);
  const livePolicies: Record<string, DeploymentPolicy[] | undefined> = {};
  for (const environment of Object.keys(expectedDeploymentPolicies)) {
    try {
      livePolicies[environment] = ghJson<{
        branch_policies: DeploymentPolicy[];
      }>([
        "api",
        `repos/${repository}/environments/${environment}/deployment-branch-policies`,
      ]).branch_policies.map(({ name, type }) => ({ name, type }));
    } catch {
      livePolicies[environment] = undefined;
    }
  }
  problems.push(...releasePolicyProblems(livePolicies));
  const required: Record<string, string[]> = {
    "release-manifest-signing": ["XBOND_RELEASE_PRIVATE_KEY"],
    "release-desktop-signing": ["TAURI_SIGNING_PRIVATE_KEY"],
    "release-android-signing": [
      "ANDROID_KEYSTORE_BASE64",
      "ANDROID_STORE_PASSWORD",
    ],
  };
  if (appleSigning) {
    required["release-desktop-signing"].push(
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
    );
    required["release-ios-signing"] = [
      "IOS_DISTRIBUTION_P12",
      "IOS_DISTRIBUTION_PASSWORD",
      "IOS_APP_PROFILE",
      "IOS_TUNNEL_PROFILE",
    ];
    required["release-store-ios"] = ["ASC_KEY"];
    for (const name of ["ASC_KEY_ID", "ASC_ISSUER_ID"]) {
      if (!variables[name]?.trim()) problems.push(`Missing ${name}.`);
    }
  }

  for (const [environment, names] of Object.entries(required)) {
    const configured = new Set(
      ghList<{ name: string }>([
        "secret",
        "list",
        "--repo",
        repository,
        "--env",
        environment,
        "--json",
        "name",
      ]).map(({ name }) => name),
    );
    for (const name of names) {
      if (!configured.has(name))
        problems.push(`Missing ${environment}/${name}.`);
    }
    if (environment === "release-desktop-signing") {
      if (
        configured.has("WINDOWS_PFX") !== configured.has("WINDOWS_PFX_PASSWORD")
      ) {
        problems.push(
          "Configure both WINDOWS_PFX and WINDOWS_PFX_PASSWORD for Authenticode.",
        );
      }
      if (!configured.has("WINDOWS_PFX"))
        console.log("Windows Authenticode PFX is not configured.");
      if (
        appleSigning &&
        !configured.has("ASC_KEY") &&
        !(configured.has("APPLE_ID") && configured.has("APPLE_PASSWORD"))
      ) {
        problems.push(
          "For macOS notarization, configure release-desktop-signing/ASC_KEY or both APPLE_ID and APPLE_PASSWORD.",
        );
      }
    }
    if (
      environment === "release-android-signing" &&
      configured.has("ANDROID_KEY_PASSWORD")
    ) {
      console.log(
        "ANDROID_KEY_PASSWORD is unused in GitHub. Use ANDROID_KEY_PASSWORD_OVERRIDE when passwords differ.",
      );
    }
  }

  if (problems.length) {
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Release configuration names and public values passed for ${appleSigning ? "production" : "rehearsal"}.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
