import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/" +
  "LaunchServices.framework/Support/lsregister";
const OSCOMPILE = "/usr/bin/osacompile";
const PLIST_BUDDY = "/usr/libexec/PlistBuddy";

/** Dev wrapper applet that owns the xbond://, clash:// and sing-box://
 * schemes. Packaged
 * builds declare the schemes in their own bundle Info.plist; a dev run has
 * no bundle, so the browser handoff (`xbond://callback?code=…`) has nowhere
 * to land. LaunchServices delivers scheme URLs as Apple Events, which a
 * bare executable never sees — hence the AppleScript applet: its
 * `openlocation` handler receives the URL and re-launches the dev binary
 * with it as argv, where single-instance handover reaches the running app
 * and cold starts carry it as a command line argument. */
export const WRAPPER_APP = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "XBondDev",
  "XBondDev.app",
);
export const WRAPPER_BUNDLE_ID = "net.xbond.app.dev";
export const WRAPPER_SCHEMES = ["xbond", "clash", "sing-box"];

/** Where `tauri dev` puts the binary: the CARGO_TARGET_DIR override wins,
 * otherwise cargo's default target dir inside src-tauri. */
export function devBinaryPath(): string {
  const targetDir =
    process.env.CARGO_TARGET_DIR ??
    path.join(root, "apps", "desktop", "src-tauri", "target");
  return path.join(targetDir, "debug", "xbond-client");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function buildOpenLocationScript(binaryPath: string): string {
  return [
    "on open location theURL",
    `  do shell script "exec ${shellQuote(binaryPath)} " & quoted form of (theURL as text) & " >/dev/null 2>&1 &"`,
    "end open location",
    "",
  ].join("\n");
}

/** PlistBuddy commands that turn the osacompile skeleton into a scheme
 * handler: hide it from the Dock, re-badge it as a dev bundle and register
 * the URL schemes. The applet is recompiled on every run, so every Add
 * starts from the stock plist. */
export function buildPlistPatchCommands(): string[] {
  return [
    `Add :CFBundleIdentifier string ${WRAPPER_BUNDLE_ID}`,
    "Add :LSUIElement bool true",
    "Add :CFBundleURLTypes array",
    "Add :CFBundleURLTypes:0 dict",
    "Add :CFBundleURLTypes:0:CFBundleURLName string net.xbond.app",
    "Add :CFBundleURLTypes:0:CFBundleURLSchemes array",
    ...WRAPPER_SCHEMES.map(
      (scheme, index) =>
        `Add :CFBundleURLTypes:0:CFBundleURLSchemes:${index} string ${scheme}`,
    ),
  ];
}

export function registerDevLinks(): { ok: boolean; message: string } {
  if (process.platform !== "darwin") {
    // Windows and Linux register the schemes at runtime through the
    // deep-link plugin; only macOS needs the LaunchServices applet.
    return {
      ok: true,
      message: `schemes register at runtime on ${process.platform}; nothing to do`,
    };
  }
  const binary = devBinaryPath();
  if (!fs.existsSync(binary)) {
    return {
      ok: false,
      message:
        "dev binary not found — run `pnpm desktop` once so tauri builds it, then retry",
    };
  }

  fs.rmSync(WRAPPER_APP, { force: true, recursive: true });
  const sourcePath = path.join(
    os.tmpdir(),
    `xbond-dev-links-${process.pid}.applescript`,
  );
  fs.writeFileSync(sourcePath, buildOpenLocationScript(binary));
  const compile = spawnSync(OSCOMPILE, ["-o", WRAPPER_APP, sourcePath], {
    stdio: "pipe",
    encoding: "utf8",
  });
  fs.rmSync(sourcePath, { force: true });
  if (compile.status !== 0) {
    return {
      ok: false,
      message: `osacompile failed: ${compile.stderr?.trim() || compile.status}`,
    };
  }

  const plist = path.join(WRAPPER_APP, "Contents", "Info.plist");
  for (const patch of buildPlistPatchCommands()) {
    const res = spawnSync(PLIST_BUDDY, ["-c", patch, plist], {
      stdio: "pipe",
      encoding: "utf8",
    });
    if (res.status !== 0) {
      return {
        ok: false,
        message: `PlistBuddy "${patch}" failed: ${res.stderr?.trim() || res.status}`,
      };
    }
  }

  const lsregister = spawnSync(LSREGISTER, ["-f", WRAPPER_APP], {
    stdio: "pipe",
    encoding: "utf8",
  });
  if (lsregister.status !== 0) {
    return {
      ok: false,
      message: `lsregister failed: ${lsregister.stderr?.trim() || lsregister.status}`,
    };
  }
  return {
    ok: true,
    message: `registered ${WRAPPER_SCHEMES.join(" + ")} -> ${binary}`,
  };
}

function main(): void {
  const command = process.argv[2];
  if (command === "register-links") {
    const res = registerDevLinks();
    if (res.ok) {
      console.log(`[desktop:links] ${res.message}`);
      process.exit(0);
    } else {
      console.error(`[desktop:links] Error: ${res.message}`);
      process.exit(1);
    }
  } else {
    console.error("Usage: node scripts/desktop.ts [register-links]");
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main();
}
