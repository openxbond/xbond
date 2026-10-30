import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUILD_TAGS } from "./go.ts";

const MOBILE_PKG = "github.com/openxbond/xbond/mobile";

export function checkGomobileInstalled(): boolean {
  const res = spawnSync("gomobile", ["version"], {
    stdio: "pipe",
  });
  return res.status === 0;
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
      message:
        "gomobile is not installed in PATH. Install with: go install golang.org/x/mobile/cmd/gomobile@latest && gomobile init",
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
      message:
        "gomobile is not installed in PATH. Install with: go install golang.org/x/mobile/cmd/gomobile@latest && gomobile init",
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
  } else {
    console.error(
      "Usage: node scripts/mobile.ts [check|bind:android|bind:ios]",
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
