import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUILD_TAGS, MOBILE_ANDROID_TAGS } from "./go.ts";

const MOBILE_PKG = "github.com/openxbond/xbond/mobile";
const ANDROID_PROJECT = "apps/mobile/android";
const ANDROID_APP_ID = "net.xbond.app";
/** Vite dev server port the mobile dev loop binds and adb-reverses. */
const MOBILE_DEV_PORT = 1421;

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
  const home = process.env.ANDROID_HOME ?? detectAndroidHome();
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
      MOBILE_ANDROID_TAGS,
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
  if (process.platform !== "darwin") {
    return {
      ok: false,
      message:
        "gomobile bind for iOS requires macOS with Xcode installed. " +
        "If you are developing via a macOS VM, please run 'pnpm mobile:bind:ios' inside your macOS environment.",
    };
  }

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

// ----------------------------------------------------------- dev / run loop

function adb(args: string[], options: { capture?: boolean } = {}): string {
  const res = spawnSync("adb", args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (options.capture) return `${res.stdout ?? ""}${res.stderr ?? ""}`;
  return "";
}

function onlineDevices(): string[] {
  const out = adb(["devices"], { capture: true });
  return out
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.endsWith("\tdevice"))
    .map((line) => line.split("\t")[0]);
}

function detectAndroidHome(): string | null {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), "Android", "Sdk"),
    path.join(os.homedir(), ".local", "android"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "platform-tools"))) return candidate;
  }
  return null;
}

/** Gradle binary: PATH first, then the newest wrapper-managed dist on disk
 * (the project carries no wrapper jar, and the dist is already downloaded). */
function resolveGradle(): string {
  if (spawnSync("gradle", ["--version"], { stdio: "pipe" }).status === 0) {
    return "gradle";
  }
  const distsDir = path.join(os.homedir(), ".gradle", "wrapper", "dists");
  const candidates: { bin: string; version: string }[] = [];
  if (fs.existsSync(distsDir)) {
    for (const entry of fs.readdirSync(distsDir)) {
      const match = entry.match(/^gradle-(\d+\.\d+(?:\.\d+)?)-bin$/);
      if (!match) continue;
      for (const hashDir of fs.readdirSync(path.join(distsDir, entry))) {
        const bin = path.join(
          distsDir,
          entry,
          hashDir,
          `gradle-${match[1]}`,
          "bin",
          "gradle",
        );
        if (fs.existsSync(bin)) {
          candidates.push({ bin, version: match[1] });
        }
      }
    }
  }
  if (candidates.length === 0) {
    throw new Error(
      "gradle not found on PATH and no wrapper dist under ~/.gradle/wrapper/dists",
    );
  }
  candidates.sort((a, b) => b.version.localeCompare(a.version));
  return candidates[0].bin;
}

/** Installs the debug APK (building the AAR and the web dist when missing).
 * Returns once `net.xbond.app` is present on the connected device. */
function ensureAppInstalled(rebuild: boolean): void {
  const devices = onlineDevices();
  if (devices.length === 0) throw new Error("no online Android device");
  const installed = adb(["shell", "pm", "list", "packages", ANDROID_APP_ID], {
    capture: true,
  }).includes(ANDROID_APP_ID);
  if (installed && !rebuild) return;

  if (
    !fs.existsSync(
      path.join(root, "apps", "mobile", "android", "xbond-mobile.aar"),
    )
  ) {
    console.log(
      "[mobile:dev] AAR missing; binding (pnpm mobile:bind:android)…",
    );
    const res = buildAndroidAAR();
    if (!res.ok) throw new Error(res.message);
  }
  if (!fs.existsSync(path.join(root, "dist", "index.html"))) {
    console.log("[mobile:dev] web dist missing; building (pnpm build)…");
    spawnSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
  }
  console.log("[mobile:dev] installing debug APK (gradle installDebug)…");
  const env = { ...process.env };
  const sdk = detectAndroidHome();
  if (sdk && !env.ANDROID_HOME) env.ANDROID_HOME = sdk;
  const res = spawnSync(resolveGradle(), ["installDebug"], {
    cwd: path.join(root, ANDROID_PROJECT),
    stdio: "inherit",
    env,
  });
  if (res.status !== 0) throw new Error("gradle installDebug failed");
}

/** Boots the first available AVD when no device is online, and waits for it
 * to finish booting. */
function ensureDeviceOnline(): void {
  if (onlineDevices().length > 0) return;
  const listAvds = spawnSync("emulator", ["-list-avds"], {
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, ANDROID_HOME: detectAndroidHome() ?? "" },
  });
  const names = (listAvds.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (names.length === 0) {
    throw new Error(
      "no online Android device and no AVD to boot (create one in Android Studio or `avdmanager`)",
    );
  }
  const pick =
    names.find((name) => name === "Medium_Phone_API_37.0") ?? names[0];
  console.log(`[mobile:dev] booting emulator ${pick}…`);
  const emulator = spawn("emulator", ["-avd", pick, "-no-snapshot-load"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ANDROID_HOME: detectAndroidHome() ?? "" },
  });
  emulator.unref();
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (onlineDevices().length > 0) {
      const boot = adb(["shell", "getprop", "sys.boot_completed"], {
        capture: true,
      }).trim();
      if (boot === "1") return;
    }
    spawnSync("sleep", ["2"]);
  }
  throw new Error("emulator did not finish booting within 180s");
}

/** `pnpm mobile:dev`: emulator + installed APK + adb reverse + Vite on
 * 127.0.0.1:1421, launched into the app through the dev_url bootstrap. The
 * Vite server stays in the foreground; Ctrl-C cleans up the reverse. */
async function runMobileDev(): Promise<void> {
  ensureDeviceOnline();
  ensureAppInstalled(process.argv.includes("--rebuild"));

  console.log(
    `[mobile:dev] starting Vite dev server on 127.0.0.1:${MOBILE_DEV_PORT}…`,
  );
  const vite = spawn(
    "pnpm",
    [
      "exec",
      "vite",
      "--port",
      String(MOBILE_DEV_PORT),
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    { cwd: root, stdio: "inherit" },
  );

  const cleanup = () => {
    adb(["reverse", "--remove", `tcp:${MOBILE_DEV_PORT}`], { capture: true });
    vite.kill("SIGINT");
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Wait for Vite to accept connections before reversing and launching.
  const deadline = Date.now() + 60_000;
  for (;;) {
    const probe = spawnSync(
      "curl",
      ["-sf", `-o`, "/dev/null", `http://127.0.0.1:${MOBILE_DEV_PORT}/`],
      { stdio: "pipe" },
    );
    if (probe.status === 0) break;
    if (Date.now() > deadline)
      throw new Error("Vite dev server did not start in time");
    if (vite.exitCode !== null)
      throw new Error("Vite dev server exited during startup");
    spawnSync("sleep", ["0.5"]);
  }

  adb(["reverse", `tcp:${MOBILE_DEV_PORT}`, `tcp:${MOBILE_DEV_PORT}`]);
  adb([
    "shell",
    "am",
    "start",
    "-n",
    `${ANDROID_APP_ID}/.MainActivity`,
    "--es",
    "dev_url",
    `http://127.0.0.1:${MOBILE_DEV_PORT}`,
  ]);
  console.log(
    "[mobile:dev] app launched against the dev server — edit packages/client-ui for instant HMR",
  );
  vite.on("exit", (code) => {
    adb(["reverse", "--remove", `tcp:${MOBILE_DEV_PORT}`], { capture: true });
    process.exit(code ?? 0);
  });
}

/** `pnpm mobile:android`: standalone APK verification — fresh web dist into
 * the APK, installDebug, launch the packaged app (no dev_url). */
function runMobileAndroid(): void {
  ensureDeviceOnline();
  console.log("[mobile:android] building web dist (pnpm build)…");
  const build = spawnSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) throw new Error("pnpm build failed");
  ensureAppInstalled(true);
  adb(["shell", "am", "start", "-n", `${ANDROID_APP_ID}/.MainActivity`]);
  console.log("[mobile:android] packaged app launched");
}

function bootedIOSSimulators(): string[] {
  const res = spawnSync("xcrun", ["simctl", "list", "devices", "booted"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (res.status !== 0) return [];
  const lines = (res.stdout ?? "").split("\n");
  const booted: string[] = [];
  for (const line of lines) {
    const match = line.match(/^(.+?)\s+\(([-0-9A-F]{36})\)\s+\(Booted\)/i);
    if (match && /^iPhone/i.test(match[1].trim())) booted.push(match[2]);
  }
  return booted;
}

function ensureIOSDeviceOnline(): string {
  const booted = bootedIOSSimulators();
  if (booted.length > 0) return booted[0];

  const res = spawnSync("xcrun", ["simctl", "list", "devices"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  const lines = (res.stdout ?? "").split("\n");
  const candidates: { name: string; id: string }[] = [];
  for (const line of lines) {
    const match = line.match(/(iPhone[^()]*)\s+\(([-0-9A-F]{36})\)/i);
    if (match) {
      candidates.push({ name: match[1].trim(), id: match[2] });
    }
  }
  if (candidates.length === 0) {
    throw new Error(
      "no online iOS device and no simulator found (install an iOS Simulator runtime in Xcode)",
    );
  }
  const pick =
    candidates.find((c) => c.name.includes("iPhone 16 Pro")) ?? candidates[0];
  console.log(`[mobile:ios] booting simulator ${pick.name} (${pick.id})…`);
  spawnSync("xcrun", ["simctl", "boot", pick.id], { stdio: "inherit" });
  return pick.id;
}

/** `pnpm mobile:ios`: standalone iOS app verification — fresh web dist,
 * ensured XBondMobile.xcframework and XBond.xcodeproj, xcodebuild, install
 * and launch the packaged app on the iOS simulator. */
export function runMobileIOS(): void {
  if (process.platform !== "darwin") {
    throw new Error(
      "pnpm mobile:ios requires macOS with Xcode installed. " +
        "If you are developing via a macOS VM, please run 'pnpm mobile:ios' inside your macOS environment.",
    );
  }

  const simId = ensureIOSDeviceOnline();

  if (
    !fs.existsSync(
      path.join(root, "apps", "mobile", "ios", "XBondMobile.xcframework"),
    )
  ) {
    console.log(
      "[mobile:ios] XBondMobile.xcframework missing; binding (pnpm mobile:bind:ios)…",
    );
    const res = buildIOSFramework();
    if (!res.ok) throw new Error(res.message);
  }

  const distHtml = path.join(root, "dist", "index.html");
  if (!fs.existsSync(distHtml)) {
    console.log("[mobile:ios] web dist missing; building (pnpm build)…");
    const build = spawnSync("pnpm", ["build"], {
      cwd: root,
      stdio: "inherit",
    });
    if (build.status !== 0) throw new Error("pnpm build failed");
  }

  const projectDir = path.join(root, "apps", "mobile", "ios");
  const xcodeProj = path.join(projectDir, "XBond.xcodeproj");
  if (!fs.existsSync(xcodeProj)) {
    console.log("[mobile:ios] generating XBond.xcodeproj via xcodegen…");
    const xcodegenRes = spawnSync(
      "xcodegen",
      ["generate", "--spec", "project.yml", "--project", "."],
      { cwd: projectDir, stdio: "inherit" },
    );
    if (xcodegenRes.status !== 0) throw new Error("xcodegen failed");
  }

  console.log(
    `[mobile:ios] building iOS simulator app for device ${simId} (xcodebuild)…`,
  );
  const derivedDataPath = path.join(
    os.homedir(),
    "Library",
    "Caches",
    "XBondDerivedData",
  );
  const buildRes = spawnSync(
    "xcodebuild",
    [
      "-project",
      xcodeProj,
      "-scheme",
      "XBond",
      "-destination",
      `id=${simId}`,
      "-derivedDataPath",
      derivedDataPath,
      "CODE_SIGNING_ALLOWED=NO",
      "build",
    ],
    { cwd: projectDir, stdio: "inherit" },
  );
  if (buildRes.status !== 0) throw new Error("xcodebuild build failed");

  const appPath = path.join(
    derivedDataPath,
    "Build",
    "Products",
    "Debug-iphonesimulator",
    "XBond.app",
  );
  console.log("[mobile:ios] installing app to simulator…");
  const installRes = spawnSync("xcrun", ["simctl", "install", simId, appPath], {
    stdio: "inherit",
  });
  if (installRes.status !== 0) throw new Error("simctl install failed");

  console.log("[mobile:ios] launching net.xbond.app on simulator…");
  const launchRes = spawnSync(
    "xcrun",
    ["simctl", "launch", simId, "net.xbond.app"],
    { stdio: "inherit" },
  );
  if (launchRes.status !== 0) throw new Error("simctl launch failed");
  console.log("[mobile:ios] packaged app launched on iOS simulator");
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
  } else if (command === "dev") {
    void runMobileDev();
  } else if (command === "android") {
    runMobileAndroid();
  } else if (command === "ios") {
    try {
      runMobileIOS();
    } catch (err) {
      console.error(
        `[mobile:ios] Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  } else {
    console.error(
      "Usage: node scripts/mobile.ts [check|ensure|bind:android|bind:ios|dev|android|ios]",
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
