import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUILD_TAGS, MOBILE_ANDROID_TAGS } from "./go.ts";

const MOBILE_PKG = "github.com/openxbond/xbond/mobile";
const ANDROID_TAURI = "src-tauri/gen/android";
const ANDROID_APP_ID = "net.xbond.app";
const ANDROID_AAR = "plugins/xbond/android/libs/xbond-mobile.aar";
const IOS_FRAMEWORK = "plugins/xbond/ios/Frameworks/XBondMobile.xcframework";
/** Vite dev server port the mobile dev loop binds and adb-reverses. */
const MOBILE_DEV_PORT = 1421;

const root = fileURLToPath(new URL("../..", import.meta.url));
const tauri = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");

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

export function buildAndroidAAR(outputPath = ANDROID_AAR): {
  ok: boolean;
  message: string;
} {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  ensureGomobile();

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

export function buildIOSFramework(outputPath = IOS_FRAMEWORK): {
  ok: boolean;
  message: string;
} {
  if (process.platform !== "darwin") {
    return {
      ok: false,
      message:
        "gomobile bind for iOS requires macOS with Xcode installed. " +
        "If you are developing via a macOS VM, please run 'pnpm ios:bind' inside your macOS environment.",
    };
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  ensureGomobile();

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
  if (res.error) throw res.error;
  if (res.status !== 0)
    throw new Error(
      `adb ${args[0]} failed (${res.status})${res.stderr ? `: ${res.stderr.trim()}` : ""}`,
    );
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

/** Installs the debug APK (building the AAR and the web dist when missing).
 * Returns once `net.xbond.app` is present on the connected device. */
function installDebugAPK(): void {
  const devices = onlineDevices();
  if (devices.length === 0) throw new Error("no online Android device");
  if (!fs.existsSync(path.join(root, ANDROID_AAR))) {
    console.log("[mobile:dev] AAR missing; binding (pnpm android:bind)…");
    const res = buildAndroidAAR();
    if (!res.ok) throw new Error(res.message);
  }
  const abi = adb(["shell", "getprop", "ro.product.cpu.abi"], {
    capture: true,
  }).trim();
  const targets: Record<string, string> = {
    "arm64-v8a": "aarch64",
    "armeabi-v7a": "armv7",
    x86: "i686",
    x86_64: "x86_64",
  };
  const target = targets[abi];
  if (!target) throw new Error(`Unsupported Android ABI: ${abi}`);

  console.log("[mobile:dev] building and installing Tauri debug APK…");
  const env = {
    ...process.env,
    ANDROID_HOME: detectAndroidHome() ?? "",
    NDK_HOME: process.env.NDK_HOME ?? resolveAndroidNdk(),
  };
  const res = spawnSync(
    process.execPath,
    [tauri, "android", "build", "--debug", "--apk", "--target", target],
    { cwd: root, stdio: "inherit", env },
  );
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error("Tauri Android build failed");
  adb([
    "install",
    "-r",
    path.join(
      root,
      ANDROID_TAURI,
      "app/build/outputs/apk/universal/debug/app-universal-debug.apk",
    ),
  ]);
}

/** Returns the adb endpoint of a running Waydroid session (the Linux
 * container Android), or null when Waydroid is absent or not running. */
function waydroidEndpoint(): string | null {
  const probe = spawnSync("waydroid", ["status"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (probe.status !== 0) return null;
  if (!/Session:\s+RUNNING/.test(probe.stdout ?? "")) return null;
  const ip = /IP address:\s*(\S+)/.exec(probe.stdout ?? "")?.[1];
  return ip ? `${ip}:5555` : null;
}

/** Boots the first available AVD when no device is online, and waits for it
 * to finish booting. Waydroid (the Linux Android container) is attached
 * first when its session is already running. */
function ensureDeviceOnline(): void {
  if (onlineDevices().length > 0) return;
  const waydroid = waydroidEndpoint();
  if (waydroid) {
    console.log(`[mobile] attaching to Waydroid at ${waydroid}…`);
    adb(["connect", waydroid]);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (onlineDevices().includes(waydroid)) return;
      spawnSync("sleep", ["1"]);
    }
    throw new Error(`Waydroid at ${waydroid} did not come online for adb`);
  }
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

/** `pnpm dev:android`: the canonical `tauri android dev` loop. The script
 * boots an emulator, makes sure the gomobile AAR is bound, forwards the Vite
 * dev port over adb (the CLI knows nothing about devices), then hands over
 * to the Tauri CLI, which starts the dev server (beforeDevCommand), builds
 * the debug APK and launches it against devUrl. Vite HMR reaches the app
 * through the reverse; the LocalAPI credentials arrive through the xbond
 * plugin, so no dev_url bootstrap exists anymore. Ctrl-C tears everything
 * down, including the reverse. */
function runMobileDev(args: string[]): void {
  ensureDeviceOnline();

  if (!fs.existsSync(path.join(root, ANDROID_AAR))) {
    console.log("[mobile:dev] AAR missing; binding (pnpm android:bind)…");
    const res = buildAndroidAAR();
    if (!res.ok) throw new Error(res.message);
  }

  adb(["reverse", `tcp:${MOBILE_DEV_PORT}`, `tcp:${MOBILE_DEV_PORT}`]);
  console.log(
    `[mobile:dev] adb reverse tcp:${MOBILE_DEV_PORT} — starting tauri android dev…`,
  );

  const dev = spawn(process.execPath, [tauri, "android", "dev", ...args], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      ANDROID_HOME: detectAndroidHome() ?? "",
      NDK_HOME: process.env.NDK_HOME ?? resolveAndroidNdk(),
    },
  });
  const cleanup = () => {
    try {
      adb(["reverse", "--remove", `tcp:${MOBILE_DEV_PORT}`], { capture: true });
    } catch (error) {
      console.warn(error instanceof Error ? error.message : error);
    }
  };
  process.on("SIGINT", () => {
    dev.kill("SIGINT");
  });
  process.on("SIGTERM", () => {
    dev.kill("SIGTERM");
  });
  dev.on("error", (error) => {
    cleanup();
    console.error(error.message);
    process.exitCode = 1;
  });
  dev.on("exit", (code) => {
    cleanup();
    process.exit(code ?? 1);
  });
}

/** `pnpm android:install`: install and launch the packaged Tauri APK. */
function runMobileAndroid(): void {
  ensureDeviceOnline();
  installDebugAPK();
  adb(["shell", "am", "start", "-n", `${ANDROID_APP_ID}/.MainActivity`]);
  console.log("[mobile:android] packaged app launched");
}

/** `pnpm dev:ios`: the canonical `tauri ios dev` loop on macOS — ensure
 * the gomobile xcframework is bound, then hand over to the Tauri CLI, which
 * builds, installs and launches on the iOS simulator against devUrl. */
export function runMobileIOS(args: string[] = []): void {
  if (process.platform !== "darwin") {
    throw new Error(
      "pnpm dev:ios requires macOS with Xcode installed. " +
        "If you are developing via a macOS VM, please run 'pnpm dev:ios' inside your macOS environment.",
    );
  }

  if (!fs.existsSync(path.join(root, IOS_FRAMEWORK))) {
    console.log(
      "[mobile:ios] XBondMobile.xcframework missing; binding (pnpm ios:bind)…",
    );
    const res = buildIOSFramework();
    if (!res.ok) throw new Error(res.message);
  }

  console.log("[mobile:ios] starting tauri ios dev…");
  const dev = spawn(process.execPath, [tauri, "ios", "dev", ...args], {
    cwd: root,
    stdio: "inherit",
  });
  dev.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  dev.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

function main(): void {
  const command = process.argv[2];
  if (command === "bind:android") {
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
  } else if (command === "dev:android") {
    runMobileDev(process.argv.slice(3));
  } else if (command === "install:android") {
    runMobileAndroid();
  } else if (command === "dev:ios") {
    try {
      runMobileIOS(process.argv.slice(3));
    } catch (err) {
      console.error(
        `[mobile:ios] Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  } else {
    console.error(
      "Usage: node scripts/dev/mobile.ts [bind:android|bind:ios|dev:android|install:android|dev:ios]",
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
