import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cliAsset, desktopRelease, releaseVersion } from "./release-version.ts";

const REPO_URL = "https://github.com/openxbond/xbond";
const WEBSITE_URL = "https://www.xbond.net/";
const SHA256_LINE = /^([a-f0-9]{64})  ([a-zA-Z0-9._-]+)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const WINGET_BASE_REL = "winget/manifests/o/OpenXBond/XBond";

export interface PackageManifestOptions {
  tag: string;
  checksums: Map<string, string>;
  releaseDate: string;
}

/** Parse a release SHA256SUMS listing into a map of filename -> lowercase hex sha256. */
export function parseSha256Sums(content: string): Map<string, string> {
  const checksums = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = SHA256_LINE.exec(line);
    if (!match) {
      throw new Error(`Invalid SHA256SUMS line: ${line}`);
    }
    const [, digest, filename] = match;
    if (checksums.has(filename)) {
      throw new Error(`Duplicate SHA256SUMS entry: ${filename}`);
    }
    checksums.set(filename, digest);
  }
  if (checksums.size === 0) {
    throw new Error("SHA256SUMS contains no entries");
  }
  return checksums;
}

function requireChecksum(
  checksums: Map<string, string>,
  assetName: string,
): string {
  const digest = checksums.get(assetName);
  if (!digest) {
    throw new Error(
      `Missing checksum for required release asset: ${assetName}`,
    );
  }
  return digest;
}

function downloadUrl(tag: string, assetName: string): string {
  return `${REPO_URL}/releases/download/${tag}/${assetName}`;
}

function renderHomebrewCask(
  version: string,
  armSha: string,
  intelSha: string,
): string {
  return `cask "xbond" do
  arch arm: "arm64", intel: "amd64"

  version "${version}"
  sha256 arm: "${armSha}",
         intel: "${intelSha}"

  url "${REPO_URL}/releases/download/v#{version}/xbond-desktop-v#{version}-darwin-#{arch}.dmg",
      verified: "github.com/openxbond/xbond/"
  name "XBond"
  desc "Cross-platform dual-core (mihomo + sing-box) proxy client"
  homepage "${WEBSITE_URL}"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true

  app "XBond.app"

  zap trash: [
    "~/Library/Application Support/net.xbond.app",
    "~/Library/Caches/net.xbond.app",
    "~/Library/Preferences/net.xbond.app.plist",
    "~/Library/Saved Application State/net.xbond.app.savedState",
  ]
end
`;
}

function renderHomebrewFormula(
  tag: string,
  version: string,
  assets: {
    darwinArm: { name: string; sha256: string };
    darwinAmd: { name: string; sha256: string };
    linuxArm: { name: string; sha256: string };
    linuxAmd: { name: string; sha256: string };
  },
): string {
  return `class XbondCli < Formula
  desc "Cross-platform dual-core (mihomo + sing-box) proxy CLI and daemon"
  homepage "${WEBSITE_URL}"
  version "${version}"
  license "AGPL-3.0-only"

  on_macos do
    on_arm do
      url "${downloadUrl(tag, assets.darwinArm.name)}"
      sha256 "${assets.darwinArm.sha256}"
    end

    on_intel do
      url "${downloadUrl(tag, assets.darwinAmd.name)}"
      sha256 "${assets.darwinAmd.sha256}"
    end
  end

  on_linux do
    on_arm do
      url "${downloadUrl(tag, assets.linuxArm.name)}"
      sha256 "${assets.linuxArm.sha256}"
    end

    on_intel do
      url "${downloadUrl(tag, assets.linuxAmd.name)}"
      sha256 "${assets.linuxAmd.sha256}"
    end
  end

  def install
    binary = Dir["xbond-v*"].first || "xbond"
    bin.install binary => "xbond"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/xbond version")
  end
end
`;
}

function renderScoopDesktop(
  tag: string,
  version: string,
  amd64: { name: string; sha256: string },
  arm64: { name: string; sha256: string },
): string {
  return (
    JSON.stringify(
      {
        version,
        description:
          "Cross-platform dual-core (mihomo + sing-box) proxy client",
        homepage: WEBSITE_URL,
        license: "AGPL-3.0-only",
        architecture: {
          "64bit": {
            url: `${downloadUrl(tag, amd64.name)}#/setup.exe`,
            hash: amd64.sha256,
          },
          arm64: {
            url: `${downloadUrl(tag, arm64.name)}#/setup.exe`,
            hash: arm64.sha256,
          },
        },
        installer: {
          args: ["/S", "/D=$dir"],
        },
        post_install:
          'Remove-Item "$dir\\setup.exe" -Force -ErrorAction SilentlyContinue',
        uninstaller: {
          file: "uninstall.exe",
          args: ["/S"],
        },
        shortcuts: [["XBond.exe", "XBond"]],
        checkver: {
          github: REPO_URL,
        },
        autoupdate: {
          architecture: {
            "64bit": {
              url: `${REPO_URL}/releases/download/v$version/xbond-desktop-v$version-windows-amd64.exe#/setup.exe`,
            },
            arm64: {
              url: `${REPO_URL}/releases/download/v$version/xbond-desktop-v$version-windows-arm64.exe#/setup.exe`,
            },
          },
          hash: {
            url: `${REPO_URL}/releases/download/v$version/SHA256SUMS`,
          },
        },
      },
      null,
      2,
    )
      .replace(
        '"args": [\n      "/S",\n      "/D=$dir"\n    ]',
        '"args": ["/S", "/D=$dir"]',
      )
      .replace('"args": [\n      "/S"\n    ]', '"args": ["/S"]')
      .replace(
        '"shortcuts": [\n    [\n      "XBond.exe",\n      "XBond"\n    ]\n  ]',
        '"shortcuts": [["XBond.exe", "XBond"]]',
      ) + "\n"
  );
}

function renderScoopCli(
  tag: string,
  version: string,
  amd64: { name: string; sha256: string },
  arm64: { name: string; sha256: string },
): string {
  return (
    JSON.stringify(
      {
        version,
        description:
          "Cross-platform dual-core (mihomo + sing-box) proxy CLI and daemon",
        homepage: WEBSITE_URL,
        license: "AGPL-3.0-only",
        architecture: {
          "64bit": {
            url: `${downloadUrl(tag, amd64.name)}#/xbond.exe`,
            hash: amd64.sha256,
          },
          arm64: {
            url: `${downloadUrl(tag, arm64.name)}#/xbond.exe`,
            hash: arm64.sha256,
          },
        },
        bin: "xbond.exe",
        checkver: {
          github: REPO_URL,
        },
        autoupdate: {
          architecture: {
            "64bit": {
              url: `${REPO_URL}/releases/download/v$version/xbond-v$version-windows-amd64.exe#/xbond.exe`,
            },
            arm64: {
              url: `${REPO_URL}/releases/download/v$version/xbond-v$version-windows-arm64.exe#/xbond.exe`,
            },
          },
          hash: {
            url: `${REPO_URL}/releases/download/v$version/SHA256SUMS`,
          },
        },
      },
      null,
      2,
    ) + "\n"
  );
}

function renderWingetVersion(version: string): string {
  return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.1.10.0.schema.json
PackageIdentifier: OpenXBond.XBond
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.10.0
`;
}

function renderWingetInstaller(
  tag: string,
  version: string,
  releaseDate: string,
  amd64: { name: string; sha256: string },
  arm64: { name: string; sha256: string },
): string {
  return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.10.0.schema.json
PackageIdentifier: OpenXBond.XBond
PackageVersion: ${version}
Platform:
  - Windows.Desktop
MinimumOSVersion: 10.0.17763.0
InstallerType: nullsoft
Scope: user
UpgradeBehavior: install
ReleaseDate: ${releaseDate}
Installers:
  - Architecture: x64
    InstallerUrl: ${downloadUrl(tag, amd64.name)}
    InstallerSha256: ${amd64.sha256.toUpperCase()}
  - Architecture: arm64
    InstallerUrl: ${downloadUrl(tag, arm64.name)}
    InstallerSha256: ${arm64.sha256.toUpperCase()}
ManifestType: installer
ManifestVersion: 1.10.0
`;
}

function renderWingetLocale(tag: string, version: string): string {
  return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.10.0.schema.json
PackageIdentifier: OpenXBond.XBond
PackageVersion: ${version}
PackageLocale: en-US
Publisher: OpenXBond
PublisherUrl: ${WEBSITE_URL}
PublisherSupportUrl: ${REPO_URL}/issues
PackageName: XBond
PackageUrl: ${WEBSITE_URL}
License: AGPL-3.0-only
LicenseUrl: ${REPO_URL}/blob/main/LICENSE
ShortDescription: Cross-platform dual-core (mihomo + sing-box) proxy client for desktop and CLI.
Tags:
  - clash
  - mihomo
  - proxy
  - sing-box
  - xbond
ReleaseNotesUrl: ${REPO_URL}/releases/tag/${tag}
ManifestType: defaultLocale
ManifestVersion: 1.10.0
`;
}

function renderAurDesktopPkgbuild(
  version: string,
  amdSha: string,
  armSha: string,
): string {
  return `# Maintainer: openxbond <no-reply@xbond.net>
pkgname=xbond-bin
pkgver=${version}
pkgrel=1
pkgdesc='Cross-platform dual-core (mihomo + sing-box) proxy desktop client'
arch=('x86_64' 'aarch64')
url='${WEBSITE_URL}'
license=('AGPL-3.0-only')
depends=('gtk3' 'webkit2gtk-4.1' 'libayatana-appindicator')
provides=('xbond')
conflicts=('xbond' 'xbond-cli-bin')
options=('!strip')
source_x86_64=("${REPO_URL}/releases/download/v\${pkgver}/xbond-desktop-v\${pkgver}-linux-amd64.deb")
source_aarch64=("${REPO_URL}/releases/download/v\${pkgver}/xbond-desktop-v\${pkgver}-linux-arm64.deb")
noextract=(
  "xbond-desktop-v\${pkgver}-linux-amd64.deb"
  "xbond-desktop-v\${pkgver}-linux-arm64.deb"
)
sha256sums_x86_64=('${amdSha}')
sha256sums_aarch64=('${armSha}')

package() {
  local deb_arch="amd64"
  if [ "\${CARCH}" = "aarch64" ]; then
    deb_arch="arm64"
  fi
  bsdtar -O -xf "\${srcdir}/xbond-desktop-v\${pkgver}-linux-\${deb_arch}.deb" 'data.tar.*' | bsdtar -xf - -C "\${pkgdir}"
}
`;
}

function renderAurDesktopSrcinfo(
  tag: string,
  version: string,
  amd: { name: string; sha256: string },
  arm: { name: string; sha256: string },
): string {
  return `pkgbase = xbond-bin
\tpkgdesc = Cross-platform dual-core (mihomo + sing-box) proxy desktop client
\tpkgver = ${version}
\tpkgrel = 1
\turl = ${WEBSITE_URL}
\tarch = x86_64
\tarch = aarch64
\tlicense = AGPL-3.0-only
\tdepends = gtk3
\tdepends = webkit2gtk-4.1
\tdepends = libayatana-appindicator
\tprovides = xbond
\tconflicts = xbond
\tconflicts = xbond-cli-bin
\tnoextract = ${amd.name}
\tnoextract = ${arm.name}
\toptions = !strip
\tsource_x86_64 = ${downloadUrl(tag, amd.name)}
\tsha256sums_x86_64 = ${amd.sha256}
\tsource_aarch64 = ${downloadUrl(tag, arm.name)}
\tsha256sums_aarch64 = ${arm.sha256}

pkgname = xbond-bin
`;
}

function renderAurCliPkgbuild(
  version: string,
  amdSha: string,
  armSha: string,
): string {
  return `# Maintainer: openxbond <no-reply@xbond.net>
pkgname=xbond-cli-bin
pkgver=${version}
pkgrel=1
pkgdesc='Cross-platform dual-core (mihomo + sing-box) proxy CLI and daemon'
arch=('x86_64' 'aarch64')
url='${WEBSITE_URL}'
license=('AGPL-3.0-only')
depends=('glibc')
provides=('xbond')
conflicts=('xbond' 'xbond-bin')
options=('!strip')
source_x86_64=("${REPO_URL}/releases/download/v\${pkgver}/xbond-v\${pkgver}-linux-amd64")
source_aarch64=("${REPO_URL}/releases/download/v\${pkgver}/xbond-v\${pkgver}-linux-arm64")
sha256sums_x86_64=('${amdSha}')
sha256sums_aarch64=('${armSha}')

package() {
  local bin_arch="amd64"
  if [ "\${CARCH}" = "aarch64" ]; then
    bin_arch="arm64"
  fi
  install -Dm755 "\${srcdir}/xbond-v\${pkgver}-linux-\${bin_arch}" "\${pkgdir}/usr/bin/xbond"
}
`;
}

function renderAurCliSrcinfo(
  tag: string,
  version: string,
  amd: { name: string; sha256: string },
  arm: { name: string; sha256: string },
): string {
  return `pkgbase = xbond-cli-bin
\tpkgdesc = Cross-platform dual-core (mihomo + sing-box) proxy CLI and daemon
\tpkgver = ${version}
\tpkgrel = 1
\turl = ${WEBSITE_URL}
\tarch = x86_64
\tarch = aarch64
\tlicense = AGPL-3.0-only
\tdepends = glibc
\tprovides = xbond
\tconflicts = xbond
\tconflicts = xbond-bin
\toptions = !strip
\tsource_x86_64 = ${downloadUrl(tag, amd.name)}
\tsha256sums_x86_64 = ${amd.sha256}
\tsource_aarch64 = ${downloadUrl(tag, arm.name)}
\tsha256sums_aarch64 = ${arm.sha256}

pkgname = xbond-cli-bin
`;
}

function renderObtainium(): string {
  const additionalSettings = JSON.stringify({
    includePrereleases: false,
    fallbackToOlderReleases: true,
    filterReleaseTitlesByRegEx: "",
    filterReleaseNotesByRegEx: "",
    verifyLatestTag: false,
    sortMethodChoice: "date",
    useLatestAssetDateAsReleaseDate: false,
    trackOnly: false,
    versionExtractionRegEx: "v([0-9]+\\.[0-9]+\\.[0-9]+)",
    matchGroupToUse: "1",
    versionDetection: true,
    apkFilterRegEx: "xbond-android-v.*\\.apk",
    invertAPKFilter: false,
    autoApkFilterByArch: true,
    appName: "XBond",
    appAuthor: "openxbond",
  });
  return (
    JSON.stringify(
      {
        id: "net.xbond.app",
        url: REPO_URL,
        author: "openxbond",
        name: "XBond",
        preferredApkIndex: 0,
        additionalSettings,
      },
      null,
      2,
    ) + "\n"
  );
}

/** Render deterministic package manager manifests for a stable release tag. */
export function renderPackageManifests(
  options: PackageManifestOptions,
): Map<string, string> {
  const parsed = releaseVersion(options.tag);
  if (parsed.prerelease) {
    throw new Error(
      `Package manager manifests only target stable releases (got ${options.tag})`,
    );
  }
  if (!DATE_PATTERN.test(options.releaseDate)) {
    throw new Error(
      `Invalid releaseDate "${options.releaseDate}"; expected YYYY-MM-DD`,
    );
  }

  const { tag, version, checksums } = {
    tag: parsed.tag,
    version: parsed.version,
    checksums: options.checksums,
  };

  const dmgArmName = desktopRelease(tag, "darwin", "arm64").installer;
  const dmgAmdName = desktopRelease(tag, "darwin", "amd64").installer;
  const dmgArmSha = requireChecksum(checksums, dmgArmName);
  const dmgAmdSha = requireChecksum(checksums, dmgAmdName);

  const cliDarwinArmName = cliAsset(tag, "darwin", "arm64");
  const cliDarwinAmdName = cliAsset(tag, "darwin", "amd64");
  const cliLinuxArmName = cliAsset(tag, "linux", "arm64");
  const cliLinuxAmdName = cliAsset(tag, "linux", "amd64");

  const debLinuxAmdName = desktopRelease(tag, "linux", "amd64").packages.find(
    (entry) => entry.format === "deb",
  )?.name;
  const debLinuxArmName = desktopRelease(tag, "linux", "arm64").packages.find(
    (entry) => entry.format === "deb",
  )?.name;
  if (!debLinuxAmdName || !debLinuxArmName) {
    throw new Error("Expected Linux deb package names from release-version");
  }

  const winDesktopAmdName = desktopRelease(tag, "windows", "amd64").installer;
  const winDesktopArmName = desktopRelease(tag, "windows", "arm64").installer;
  const winCliAmdName = cliAsset(tag, "windows", "amd64");
  const winCliArmName = cliAsset(tag, "windows", "arm64");

  const wingetPrefix = `${WINGET_BASE_REL}/${version}`;
  const files = new Map<string, string>();

  files.set(
    "homebrew/Casks/xbond.rb",
    renderHomebrewCask(version, dmgArmSha, dmgAmdSha),
  );
  files.set(
    "homebrew/Formula/xbond-cli.rb",
    renderHomebrewFormula(tag, version, {
      darwinArm: {
        name: cliDarwinArmName,
        sha256: requireChecksum(checksums, cliDarwinArmName),
      },
      darwinAmd: {
        name: cliDarwinAmdName,
        sha256: requireChecksum(checksums, cliDarwinAmdName),
      },
      linuxArm: {
        name: cliLinuxArmName,
        sha256: requireChecksum(checksums, cliLinuxArmName),
      },
      linuxAmd: {
        name: cliLinuxAmdName,
        sha256: requireChecksum(checksums, cliLinuxAmdName),
      },
    }),
  );

  files.set(
    "scoop/xbond.json",
    renderScoopDesktop(
      tag,
      version,
      {
        name: winDesktopAmdName,
        sha256: requireChecksum(checksums, winDesktopAmdName),
      },
      {
        name: winDesktopArmName,
        sha256: requireChecksum(checksums, winDesktopArmName),
      },
    ),
  );
  files.set(
    "scoop/xbond-cli.json",
    renderScoopCli(
      tag,
      version,
      {
        name: winCliAmdName,
        sha256: requireChecksum(checksums, winCliAmdName),
      },
      {
        name: winCliArmName,
        sha256: requireChecksum(checksums, winCliArmName),
      },
    ),
  );

  files.set(
    `${wingetPrefix}/OpenXBond.XBond.yaml`,
    renderWingetVersion(version),
  );
  files.set(
    `${wingetPrefix}/OpenXBond.XBond.installer.yaml`,
    renderWingetInstaller(
      tag,
      version,
      options.releaseDate,
      {
        name: winDesktopAmdName,
        sha256: requireChecksum(checksums, winDesktopAmdName),
      },
      {
        name: winDesktopArmName,
        sha256: requireChecksum(checksums, winDesktopArmName),
      },
    ),
  );
  files.set(
    `${wingetPrefix}/OpenXBond.XBond.locale.en-US.yaml`,
    renderWingetLocale(tag, version),
  );

  const debAmd = {
    name: debLinuxAmdName,
    sha256: requireChecksum(checksums, debLinuxAmdName),
  };
  const debArm = {
    name: debLinuxArmName,
    sha256: requireChecksum(checksums, debLinuxArmName),
  };
  files.set(
    "aur/xbond-bin/PKGBUILD",
    renderAurDesktopPkgbuild(version, debAmd.sha256, debArm.sha256),
  );
  files.set(
    "aur/xbond-bin/.SRCINFO",
    renderAurDesktopSrcinfo(tag, version, debAmd, debArm),
  );

  const cliLinuxAmd = {
    name: cliLinuxAmdName,
    sha256: requireChecksum(checksums, cliLinuxAmdName),
  };
  const cliLinuxArm = {
    name: cliLinuxArmName,
    sha256: requireChecksum(checksums, cliLinuxArmName),
  };
  files.set(
    "aur/xbond-cli-bin/PKGBUILD",
    renderAurCliPkgbuild(version, cliLinuxAmd.sha256, cliLinuxArm.sha256),
  );
  files.set(
    "aur/xbond-cli-bin/.SRCINFO",
    renderAurCliSrcinfo(tag, version, cliLinuxAmd, cliLinuxArm),
  );

  files.set("obtainium/xbond.json", renderObtainium());

  return files;
}

/** Write rendered manifests to disk, pruning stale WinGet version folders when present. */
export function writePackageManifests(
  outputDir: string,
  files: Map<string, string>,
  currentVersion: string,
): void {
  const wingetRoot = path.join(outputDir, WINGET_BASE_REL);
  if (fs.existsSync(wingetRoot)) {
    for (const entry of fs.readdirSync(wingetRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== currentVersion) {
        fs.rmSync(path.join(wingetRoot, entry.name), {
          recursive: true,
          force: true,
        });
      }
    }
  }
  for (const [relativePath, content] of files) {
    const target = path.join(outputDir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

async function fetchReleaseInputs(
  tag: string,
  releaseDateOverride?: string,
): Promise<{ checksums: Map<string, string>; releaseDate: string }> {
  const sumUrl = downloadUrl(tag, "SHA256SUMS");
  const sumRes = await fetch(sumUrl);
  if (!sumRes.ok) {
    throw new Error(`Failed to fetch ${sumUrl}: HTTP ${sumRes.status}`);
  }
  const checksums = parseSha256Sums(await sumRes.text());

  if (releaseDateOverride) {
    return { checksums, releaseDate: releaseDateOverride };
  }

  let releaseDate = "";
  const apiUrl = `https://api.github.com/repos/openxbond/xbond/releases/tags/${tag}`;
  const relRes = await fetch(apiUrl, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "xbond-release-manifests/1.0",
    },
  });
  if (relRes.ok) {
    const body = (await relRes.json()) as { published_at?: unknown };
    if (
      typeof body.published_at === "string" &&
      DATE_PATTERN.test(body.published_at.slice(0, 10))
    ) {
      releaseDate = body.published_at.slice(0, 10);
    }
  }
  if (!releaseDate) {
    try {
      const committed = execFileSync(
        "git",
        ["log", "-1", "--format=%cs", tag],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      if (DATE_PATTERN.test(committed)) releaseDate = committed;
    } catch {
      // ignore if tag is not local yet
    }
  }
  if (!releaseDate) {
    throw new Error(
      "Could not determine release date from GitHub API or git tag; pass --release-date YYYY-MM-DD",
    );
  }
  return { checksums, releaseDate };
}

function parseCliArgs(argv: readonly string[]) {
  let tag = "";
  let checksumsPath: string | undefined;
  let fetchRemote = false;
  let releaseDate: string | undefined;
  let outputDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../packaging",
  );

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--fetch") {
      fetchRemote = true;
    } else if (arg === "--checksums") {
      checksumsPath = argv[++i];
    } else if (arg === "--release-date") {
      releaseDate = argv[++i];
    } else if (arg === "--output") {
      outputDir = path.resolve(argv[++i] ?? "");
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/release/package-manifests.ts <vX.Y.Z> [--checksums <file> | --fetch] [--release-date YYYY-MM-DD] [--output <dir>]",
      );
      process.exit(0);
    } else if (!arg.startsWith("-") && !tag) {
      tag = arg;
    } else {
      throw new Error(`Unknown or duplicate argument: ${arg}`);
    }
  }
  if (!tag) {
    throw new Error(
      "Usage: node scripts/release/package-manifests.ts <vX.Y.Z> [--checksums <file> | --fetch] [--release-date YYYY-MM-DD] [--output <dir>]",
    );
  }
  if (Boolean(checksumsPath) === fetchRemote) {
    throw new Error("Specify exactly one of --checksums <file> or --fetch");
  }
  return { tag, checksumsPath, fetchRemote, releaseDate, outputDir };
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const { version } = releaseVersion(args.tag);

  let checksums: Map<string, string>;
  let releaseDate = args.releaseDate;

  if (args.fetchRemote) {
    const remote = await fetchReleaseInputs(args.tag, releaseDate);
    checksums = remote.checksums;
    releaseDate = remote.releaseDate;
  } else {
    checksums = parseSha256Sums(fs.readFileSync(args.checksumsPath!, "utf8"));
    if (!releaseDate) {
      releaseDate = execFileSync(
        "git",
        ["log", "-1", "--format=%cs", args.tag],
        { encoding: "utf8" },
      ).trim();
    }
  }

  const files = renderPackageManifests({
    tag: args.tag,
    checksums,
    releaseDate: releaseDate!,
  });
  writePackageManifests(args.outputDir, files, version);
  console.log(
    `Generated ${files.size} package manager manifest file(s) for ${args.tag} into ${args.outputDir}.`,
  );
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  await main();
}
