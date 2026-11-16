import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { releaseVersion } from "../release/release-version.ts";

// The tracked release version lives in package.json. Every other file that
// embeds it is derived by `pnpm version:set` and re-checked by
// `pnpm check:version`, so a release never depends on remembering a list of
// scattered edits. Release candidates are Tags, not file versions: the
// candidate identity rides the tag and the shared build number.
const repository = fileURLToPath(new URL("../..", import.meta.url));

interface VersionSource {
  file: string;
  /** Global pattern whose single capture group is the version token. */
  pattern: RegExp;
  count: number;
}

export const versionSources: readonly VersionSource[] = [
  {
    file: "package.json",
    pattern: /^  "version": "([^"]+)",$/gm,
    count: 1,
  },
  {
    file: "src-tauri/tauri.conf.json",
    pattern: /^  "version": "([^"]+)",$/gm,
    count: 1,
  },
  {
    file: "src-tauri/Cargo.toml",
    pattern: /^version = "([^"]+)"$/gm,
    count: 1,
  },
  {
    file: "plugins/xbond/Cargo.toml",
    pattern: /^version = "([^"]+)"$/gm,
    count: 1,
  },
  {
    file: "src-tauri/Cargo.lock",
    pattern: /name = "xbond-app"\nversion = "([^"]+)"/g,
    count: 1,
  },
  {
    file: "src-tauri/Cargo.lock",
    pattern: /name = "tauri-plugin-xbond"\nversion = "([^"]+)"/g,
    count: 1,
  },
  {
    file: "src-tauri/gen/apple/project.yml",
    pattern: /^    MARKETING_VERSION: "([^"]+)"$/gm,
    count: 1,
  },
  {
    file: "src-tauri/gen/apple/XBond.xcconfig",
    pattern: /^XBOND_MARKETING_VERSION = (.+)$/gm,
    count: 1,
  },
  {
    file: "src-tauri/gen/apple/xbond-app.xcodeproj/project.pbxproj",
    pattern: /^\t+MARKETING_VERSION = (\d[^;]*);$/gm,
    count: 2,
  },
  {
    file: "internal/version/version.go",
    pattern: /^\tVersion\s+= "([^"]+)"/gm,
    count: 1,
  },
  {
    file: "packages/client-ui/src/features/settings/client-version.ts",
    pattern: /__APP_VERSION__ : "([^"]+)";/g,
    count: 1,
  },
];

// src-tauri/gen/android/app/tauri.properties is deliberately NOT a version
// source: the Tauri CLI regenerates it on every `tauri android init`/build
// with its own versionCode formula, so checking it only produces local noise.
// Release identity is verified against the built APK badging in
// scripts/release/release-android.ts; local debug builds fall back to whatever
// the Tauri CLI last wrote (build.gradle.kts).

export function readVersion(root = repository): string {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { version: string };
  return manifest.version;
}

export function setVersion(version: string, root = repository): void {
  if (releaseVersion(`v${version}`).prerelease)
    throw new Error(
      "File versions are stable baselines; release candidates are Tags (vX.Y.Z-rc.N).",
    );
  for (const source of versionSources) {
    const file = path.join(root, source.file);
    if (!fs.existsSync(file)) {
      throw new Error(`Missing version source: ${source.file}`);
    }
    const text = fs.readFileSync(file, "utf8");
    const next = version;
    let seen = 0;
    const updated = text.replace(source.pattern, (match, current: string) => {
      seen += 1;
      if (current === next) return match;
      const replaced = match.replace(current, next);
      if (replaced === match)
        throw new Error(`Cannot update ${source.file}: ${current}`);
      return replaced;
    });
    if (seen !== source.count)
      throw new Error(
        `${source.file}: expected ${source.count} version occurrence(s), found ${seen}`,
      );
    fs.writeFileSync(file, updated);
  }
  console.log(
    `Set ${version} across ${versionSources.length} version sources.`,
  );
}

export function verifyVersion(root = repository): string[] {
  const version = readVersion(root);
  const problems: string[] = [];
  for (const source of versionSources) {
    const file = path.join(root, source.file);
    if (!fs.existsSync(file)) {
      problems.push(`${source.file}: missing`);
      continue;
    }
    const matches = [...fs.readFileSync(file, "utf8").matchAll(source.pattern)];
    const next = version;
    if (matches.length !== source.count) {
      problems.push(
        `${source.file}: expected ${source.count} version occurrence(s), found ${matches.length}`,
      );
      continue;
    }
    for (const match of matches) {
      if (match[1] !== next)
        problems.push(`${source.file}: ${match[1]} does not match ${next}`);
    }
  }
  return problems;
}

function main(): void {
  const [command, value] = process.argv.slice(2);
  if (command === "set") {
    if (!value) throw new Error("Usage: pnpm version:set <x.y.z>");
    setVersion(value);
    return;
  }
  if (command === "check") {
    const problems = verifyVersion();
    if (problems.length) {
      for (const problem of problems) console.error(problem);
      process.exitCode = 1;
      return;
    }
    console.log(
      `Version ${readVersion()} is consistent across ${versionSources.length} sources.`,
    );
    return;
  }
  throw new Error("Usage: node scripts/dev/version.ts <set <x.y.z>|check>");
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main();
}
