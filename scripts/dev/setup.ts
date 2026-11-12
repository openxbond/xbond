import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { ANDROID_SDK_PACKAGES } from "./android-sdk.ts";
import { detectAndroidHome } from "./mobile.ts";

function available(file: string, args: string[]) {
  return spawnSync(file, args, { stdio: "ignore" }).status === 0;
}

function run(file: string, args: string[]) {
  const result = spawnSync(file, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${file} failed: ${result.status ?? result.signal}`);
}

function aptInstall(packages: string[]) {
  const missing = packages.filter(
    (name) =>
      spawnSync("dpkg-query", ["-W", "-f=${db:Status-Status}", name], {
        encoding: "utf8",
      }).stdout !== "installed",
  );
  if (!missing.length) return;
  const command = process.getuid?.() === 0 ? "apt-get" : "sudo";
  const prefix = command === "sudo" ? ["apt-get"] : [];
  run(command, [...prefix, "update"]);
  run(command, [...prefix, "install", "-y", ...missing]);
}

function setupDesktop(appimage: boolean) {
  if (process.platform === "linux") {
    if (!available("apt-get", ["--version"])) {
      if (
        !available("pkg-config", [
          "--exists",
          "webkit2gtk-4.1",
          "gtk+-3.0",
          "xdo",
          "openssl",
          "librsvg-2.0",
        ])
      )
        throw new Error(
          "Install your distribution's Tauri dependencies (see docs/dev-env.md)",
        );
    } else {
      aptInstall([
        "build-essential",
        "curl",
        "wget",
        "file",
        "libwebkit2gtk-4.1-dev",
        "libgtk-3-dev",
        "libayatana-appindicator3-dev",
        "librsvg2-dev",
        "libxdo-dev",
        "libssl-dev",
        ...(appimage
          ? [
              available("apt-cache", ["show", "libfuse2t64"])
                ? "libfuse2t64"
                : "libfuse2",
            ]
          : []),
      ]);
    }
  } else if (process.platform === "darwin") {
    run("xcode-select", ["-p"]);
  } else if (process.platform === "win32") {
    const installer = join(
      process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)",
      "Microsoft Visual Studio/Installer/vswhere.exe",
    );
    const result = spawnSync(
      installer,
      [
        "-latest",
        "-products",
        "*",
        "-requires",
        process.arch === "arm64"
          ? "Microsoft.VisualStudio.Component.VC.Tools.ARM64"
          : "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-property",
        "installationPath",
      ],
      { encoding: "utf8" },
    );
    if (!result.stdout?.trim())
      throw new Error(
        "Install Visual Studio Build Tools with the Desktop development with C++ workload (see docs/dev-env.md)",
      );
  } else {
    throw new Error(`Unsupported desktop host: ${process.platform}`);
  }
  run("rustup", ["component", "add", "rustfmt"]);
}

function setupAndroid() {
  const home =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    detectAndroidHome();
  if (!home)
    throw new Error(
      "Install Android command-line tools and set ANDROID_HOME (see docs/dev-env.md)",
    );
  const windows = process.platform === "win32";
  const name = windows ? "sdkmanager.bat" : "sdkmanager";
  const localManager = join(home, "cmdline-tools", "latest", "bin", name);
  // The CI bootstrap adds its versioned command-line tools to PATH.
  const manager = existsSync(localManager) ? localManager : name;
  const sdkArgs = [`--sdk_root=${home}`, "--install", ...ANDROID_SDK_PACKAGES];
  if (windows) {
    const command = [manager, ...sdkArgs].map((arg) => `"${arg}"`).join(" ");
    const result = spawnSync("cmd.exe", ["/d", "/s", "/c", `"${command}"`], {
      windowsVerbatimArguments: true,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`sdkmanager failed: ${result.status ?? result.signal}`);
  } else {
    run(manager, sdkArgs);
  }
  run("rustup", [
    "target",
    "add",
    "aarch64-linux-android",
    "armv7-linux-androideabi",
    "i686-linux-android",
    "x86_64-linux-android",
  ]);
}

function setupIOS() {
  if (process.platform !== "darwin")
    throw new Error("iOS development requires macOS");
  run("xcode-select", ["-p"]);
  const missing = [
    ["xcodegen", "xcodegen"],
    ["pod", "cocoapods"],
  ]
    .filter(([file]) => !available(file, ["--version"]))
    .map(([, formula]) => formula);
  if (missing.length) run("brew", ["install", ...missing]);
  run("rustup", [
    "target",
    "add",
    "aarch64-apple-ios",
    "aarch64-apple-ios-sim",
    "x86_64-apple-ios",
  ]);
}

function setupRelease() {
  if (available("minisign", ["-v"])) return;
  if (process.platform === "darwin") run("brew", ["install", "minisign"]);
  else if (process.platform === "linux" && available("apt-get", ["--version"]))
    aptInstall(["minisign"]);
  else throw new Error("Install minisign to verify release manifests");
}

const [target, option, ...extra] = process.argv.slice(2);
if (
  extra.length ||
  (option && (target !== "desktop" || option !== "--appimage"))
)
  throw new Error(
    "Usage: pnpm setup:<desktop|android|ios|release> [--appimage (desktop only)]",
  );
switch (target) {
  case "desktop":
    setupDesktop(option === "--appimage");
    break;
  case "android":
    setupAndroid();
    break;
  case "ios":
    setupIOS();
    break;
  case "release":
    setupRelease();
    break;
  default:
    throw new Error(
      "Use pnpm setup:desktop, setup:android, setup:ios or setup:release",
    );
}
