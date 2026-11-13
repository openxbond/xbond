const STABLE_TAG = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export function releaseVersion(tag: string) {
  const match = STABLE_TAG.exec(tag);
  if (!match || match[0] !== tag)
    throw new Error("Expected a stable vX.Y.Z tag");

  const [major, minor, patch] = match.slice(1).map(Number);
  // NSIS, Android and Apple share this bounded, monotonically increasing range.
  if (major > 99 || minor > 99 || patch > 99) {
    throw new Error("Release version components must be between 0 and 99");
  }
  const build = major * 10_000 + minor * 100 + patch;
  if (build === 0) throw new Error("The release build number must be positive");
  return { tag, version: tag.slice(1), build };
}

export const releaseTargets = [
  ["windows", "amd64"],
  ["windows", "arm64"],
  ["linux", "amd64"],
  ["linux", "arm64"],
  ["darwin", "amd64"],
  ["darwin", "arm64"],
] as const;

export function cliAsset(tag: string, os: string, arch: string) {
  return `xbond-${tag}-${os}-${arch}${os === "windows" ? ".exe" : ""}`;
}

const desktopFormats = {
  windows: { bundle: "nsis", extension: ".exe" },
  darwin: { bundle: "dmg", extension: ".dmg" },
  linux: { bundle: "appimage", extension: ".AppImage" },
};

export const linuxPackageFormats = ["deb", "rpm"] as const;

export function desktopRelease(
  tag: string,
  os: keyof typeof desktopFormats,
  arch: string,
) {
  const { bundle, extension } = desktopFormats[os];
  const stem = `xbond-desktop-${tag}-${os}-${arch}`;
  const installer = stem + extension;
  return {
    bundle,
    extension,
    installer,
    updater: os === "darwin" ? stem + ".app.tar.gz" : installer,
    packages:
      os === "linux"
        ? linuxPackageFormats.map((format) => ({
            format,
            name: `${stem}.${format}`,
          }))
        : [],
  };
}

/** Android ABIs shipped as per-ABI APKs. Every supported device reports one
 * of these as its first supported ABI, so the in-app updater always matches
 * one. The unsuffixed universal APK also ships for manual downloads where
 * the user may not know their device's ABI. */
export const androidAbis = [
  "arm64-v8a",
  "armeabi-v7a",
  "x86",
  "x86_64",
] as const;

export function androidAsset(tag: string, abi?: (typeof androidAbis)[number]) {
  return abi ? `xbond-android-${tag}-${abi}.apk` : `xbond-android-${tag}.apk`;
}
