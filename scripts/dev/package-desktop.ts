import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import config from "../../src-tauri/tauri.conf.json" with { type: "json" };
import { BUILD_TAGS, VERSION_PACKAGE } from "./go.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const tauriDirectory = join(root, "src-tauri");

function run(file: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(file, args, { cwd: root, stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${file} failed: ${result.status ?? result.signal}`);
}

export function desktopRustTarget(
  os: "windows" | "darwin" | "linux",
  arch: "amd64" | "arm64",
) {
  const suffix = {
    windows: "pc-windows-msvc",
    darwin: "apple-darwin",
    linux: "unknown-linux-gnu",
  }[os];
  return `${arch === "amd64" ? "x86_64" : "aarch64"}-${suffix}`;
}

export function buildDesktopBundle(options: {
  target: string;
  targetDirectory: string;
  version: string;
  prepareSidecar: (destination: string) => void;
  configs?: string[];
  args?: string[];
  env?: NodeJS.ProcessEnv;
}) {
  const binaries = join(tauriDirectory, "binaries");
  mkdirSync(binaries, { recursive: true });
  const staging = mkdtempSync(join(binaries, "xbond-daemon-"));
  try {
    const extension = options.target.endsWith("-windows-msvc") ? ".exe" : "";
    options.prepareSidecar(
      join(staging, `xbond-daemon-${options.target}${extension}`),
    );
    const sidecar = `binaries/${basename(staging)}/xbond-daemon`;
    run(
      process.execPath,
      [
        join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"),
        "build",
        "--config",
        join(tauriDirectory, "tauri.desktop.conf.json"),
        "--config",
        JSON.stringify({
          version: options.version,
          bundle: { active: true, externalBin: [sidecar] },
        }),
        ...(options.configs ?? []).flatMap((config) => ["--config", config]),
        "--target",
        options.target,
        "--features",
        "desktop",
        ...(options.args ?? []),
      ],
      {
        ...process.env,
        ...options.env,
        CARGO_TARGET_DIR: options.targetDirectory,
        XBOND_VERSION: options.version,
        XBOND_DESKTOP_RELEASE: "1",
      },
    );
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function packageDesktop(args: string[]) {
  if (
    args.length &&
    (args[0] !== "--bundles" ||
      args.length < 2 ||
      args.slice(1).some((arg) => arg.startsWith("-")))
  )
    throw new Error("Usage: pnpm package:desktop [--bundles <formats...>]");

  const os = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  if (
    (os !== "linux" && os !== "darwin" && os !== "windows") ||
    (arch !== "amd64" && arch !== "arm64")
  )
    throw new Error(`Unsupported desktop host: ${os}/${arch}`);

  const target = desktopRustTarget(os, arch);
  const targetDirectory = resolve(
    root,
    process.env.CARGO_TARGET_DIR ?? join(tauriDirectory, "target"),
    "local",
  );
  buildDesktopBundle({
    target,
    targetDirectory,
    version: config.version,
    args: ["--no-sign", ...args],
    prepareSidecar(destination) {
      run(
        "go",
        [
          "build",
          "-tags",
          BUILD_TAGS,
          "-trimpath",
          "-ldflags",
          `-s -w -X ${VERSION_PACKAGE}=${config.version}`,
          "-o",
          destination,
          "./cmd/xbond",
        ],
        { ...process.env, CGO_ENABLED: "0", GOOS: os, GOARCH: arch },
      );
    },
  });
  console.log(
    `Local installers: ${join(targetDirectory, target, "release", "bundle")}`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  packageDesktop(process.argv.slice(2));
}
