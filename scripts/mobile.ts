import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUILD_TAGS } from "./go.ts";

const MOBILE_PKG = "github.com/openxbond/xbond/mobile";

const root = fileURLToPath(new URL("..", import.meta.url));

export function checkGomobileInstalled(): boolean {
  const res = spawnSync("gomobile", ["version"], {
    stdio: "pipe",
  });
  return res.status === 0;
}

function checkGobindInstalled(): boolean {
  // gobind exits non-zero without arguments, so detect the binary itself.
  return spawnSync("gobind", [], { stdio: "pipe" }).error === undefined;
}

function gomobileVersion(): string {
  const res = spawnSync(
    "go",
    ["list", "-m", "-f", "{{.Version}}", "golang.org/x/mobile"],
    { cwd: root, encoding: "utf8", stdio: "pipe" },
  );
  if (res.status !== 0) {
    throw new Error(
      `Cannot resolve the golang.org/x/mobile version from go.mod: ${res.stderr?.toString() || res.stdout?.toString()}`,
    );
  }
  return res.stdout.trim();
}

// Installs gomobile and gobind at the version go.mod pins, so CI and local
// builds never drift from the module graph.
export function ensureGomobile(): void {
  const missing = [
    ...(checkGomobileInstalled() ? [] : ["gomobile"]),
    ...(checkGobindInstalled() ? [] : ["gobind"]),
  ];
  if (missing.length === 0) return;
  const version = gomobileVersion();
  for (const tool of missing) {
    const res = spawnSync(
      "go",
      ["install", `golang.org/x/mobile/cmd/${tool}@${version}`],
      { cwd: root, stdio: "inherit" },
    );
    if (res.status !== 0)
      throw new Error(`go install golang.org/x/mobile/cmd/${tool} failed`);
  }
}

function compareVersionsDesc(a: string, b: string): number {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (aParts[index] !== bParts[index])
      return (bParts[index] ?? 0) - (aParts[index] ?? 0);
  }
  return 0;
}

// Single source for the NDK gomobile binds against: an explicit
// ANDROID_NDK_HOME wins, otherwise the newest SDK-installed NDK.
export function resolveAndroidNdk(): string {
  const configured = process.env.ANDROID_NDK_HOME;
  if (configured) return configured;
  const home = process.env.ANDROID_HOME;
  if (!home)
    throw new Error(
      "Set ANDROID_HOME (the Android SDK root) or ANDROID_NDK_HOME for the Android bind",
    );
  const ndkRoot = path.join(home, "ndk");
  const versions = fs.existsSync(ndkRoot)
    ? fs
        .readdirSync(ndkRoot)
        .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
        .sort(compareVersionsDesc)
    : [];
  if (versions.length === 0)
    throw new Error(`No Android NDK found under ${ndkRoot}`);
  return path.join(ndkRoot, versions[0]);
}

export function runMobileCheck(): { ok: boolean; message: string } {
  // 1. go vet on mobile package
  const vet = spawnSync("go", ["vet", "-tags", BUILD_TAGS, "./mobile/..."], {
    stdio: "pipe",
  });
  if (vet.status !== 0) {
    const err =
      vet.stderr?.toString() || vet.stdout?.toString() || "vet failed";
    return { ok: false, message: `go vet failed: ${err}` };
  }

  // 2. go test on mobile package
  const test = spawnSync("go", ["test", "-tags", BUILD_TAGS, "./mobile/..."], {
    stdio: "pipe",
  });
  if (test.status !== 0) {
    const err =
      test.stderr?.toString() || test.stdout?.toString() || "test failed";
    return { ok: false, message: `go test failed: ${err}` };
  }

  return { ok: true, message: "Mobile Go package passed vet and unit tests" };
}

export function buildAndroidAAR(
  outputPath = "apps/mobile/android/xbond-mobile.aar",
): {
  ok: boolean;
  message: string;
} {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!checkGomobileInstalled()) {
    return {
      ok: false,
      message: "gomobile is not installed in PATH. Run: pnpm mobile:ensure",
    };
  }

  const res = spawnSync(
    "gomobile",
    [
      "bind",
      "-target",
      "android",
      "-androidapi",
      "21",
      "-tags",
      BUILD_TAGS,
      "-ldflags",
      "-s -w",
      "-o",
      outputPath,
      MOBILE_PKG,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, ANDROID_NDK_HOME: resolveAndroidNdk() },
    },
  );

  if (res.status !== 0) {
    return {
      ok: false,
      message: `gomobile bind for Android failed with code ${res.status}`,
    };
  }

  return { ok: true, message: `Successfully built ${outputPath}` };
}

export function buildIOSFramework(
  outputPath = "apps/mobile/ios/XBondMobile.xcframework",
): {
  ok: boolean;
  message: string;
} {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!checkGomobileInstalled()) {
    return {
      ok: false,
      message: "gomobile is not installed in PATH. Run: pnpm mobile:ensure",
    };
  }

  const res = spawnSync(
    "gomobile",
    [
      "bind",
      "-target",
      "ios",
      "-tags",
      BUILD_TAGS,
      "-o",
      outputPath,
      MOBILE_PKG,
    ],
    {
      stdio: "inherit",
    },
  );

  if (res.status !== 0) {
    return {
      ok: false,
      message: `gomobile bind for iOS failed with code ${res.status}`,
    };
  }

  return { ok: true, message: `Successfully built ${outputPath}` };
}

function main(): void {
  const command = process.argv[2];
  if (command === "check") {
    const res = runMobileCheck();
    if (res.ok) {
      console.log(`[mobile:check] ${res.message}`);
      process.exit(0);
    } else {
      console.error(`[mobile:check] Error: ${res.message}`);
      process.exit(1);
    }
  } else if (command === "bind:android") {
    const res = buildAndroidAAR();
    if (res.ok) {
      console.log(`[mobile:bind:android] ${res.message}`);
      process.exit(0);
    } else {
      console.error(`[mobile:bind:android] Error: ${res.message}`);
      process.exit(1);
    }
  } else if (command === "bind:ios") {
    const res = buildIOSFramework();
    if (res.ok) {
      console.log(`[mobile:bind:ios] ${res.message}`);
      process.exit(0);
    } else {
      console.error(`[mobile:bind:ios] Error: ${res.message}`);
      process.exit(1);
    }
  } else if (command === "ensure") {
    ensureGomobile();
    console.log("[mobile:ensure] gomobile and gobind match go.mod");
  } else {
    console.error(
      "Usage: node scripts/mobile.ts [check|ensure|bind:android|bind:ios]",
    );
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main();
}
