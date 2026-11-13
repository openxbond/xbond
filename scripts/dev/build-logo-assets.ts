import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

export const PATH_ORANGE = "M14 14H35.5L58 50L35.5 86H14L36.5 50L14 14Z";
export const PATH_RIGHT =
  "M64.5 14H86L65.25 47.2L54.5 30Z M54.5 70L65.25 52.8L86 86H64.5Z";

export const LOGO_SVG = `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="${PATH_ORANGE}" fill="#F38020" />
  <path d="${PATH_RIGHT}" fill="currentColor" />
</svg>
`;

// Launch-screen glyph (SplashLogo.imageset): the storyboard renders it alone
// on the system background, so the wings carry the explicit favicon ink
// per luminosity variant (currentColor cannot resolve in PNG rendering).
export const SPLASH_LOGO_SVG_LIGHT = `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="${PATH_ORANGE}" fill="#F38020" />
  <path d="${PATH_RIGHT}" fill="#18181B" />
</svg>
`;

export const SPLASH_LOGO_SVG_DARK = `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="${PATH_ORANGE}" fill="#F38020" />
  <path d="${PATH_RIGHT}" fill="#FFFFFF" />
</svg>
`;

export const FAVICON_SVG = `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <style>
    .right-wing { fill: #18181B; }
    @media (prefers-color-scheme: dark) {
      .right-wing { fill: #FFFFFF; }
    }
  </style>
  <path d="${PATH_ORANGE}" fill="#F38020" />
  <path class="right-wing" d="${PATH_RIGHT}" />
</svg>
`;

export function createRoundedIconSvg(rx = 22): string {
  return `<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect width="100" height="100" rx="${rx}" fill="#131313" />
  <path d="${PATH_ORANGE}" fill="#F38020" />
  <path d="${PATH_RIGHT}" fill="#FFFFFF" />
</svg>`;
}

export function createCircleIconSvg(scale = 0.78): string {
  return `<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="50" fill="#131313" />
  <g transform="translate(50, 50) scale(${scale}) translate(-50, -50)">
    <path d="${PATH_ORANGE}" fill="#F38020" />
    <path d="${PATH_RIGHT}" fill="#FFFFFF" />
  </g>
</svg>`;
}

export function createSquareIconSvg(): string {
  return `<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect width="100" height="100" fill="#131313" />
  <path d="${PATH_ORANGE}" fill="#F38020" />
  <path d="${PATH_RIGHT}" fill="#FFFFFF" />
</svg>`;
}

export function renderPng(svgString: string, size: number): Buffer {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: "width", value: size },
  });
  return Buffer.from(resvg.render().asPng());
}

export function createIco(
  images: Array<{ size: number; png: Buffer }>,
): Buffer {
  const headerSize = 6;
  const dirEntrySize = 16;
  const totalHeaderSize = headerSize + images.length * dirEntrySize;

  let currentOffset = totalHeaderSize;
  const header = Buffer.alloc(totalHeaderSize);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const chunks: Buffer[] = [header];

  images.forEach((img, i) => {
    const entryOffset = headerSize + i * dirEntrySize;
    const dimension = img.size >= 256 ? 0 : img.size;

    header.writeUInt8(dimension, entryOffset + 0);
    header.writeUInt8(dimension, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(img.png.length, entryOffset + 8);
    header.writeUInt32LE(currentOffset, entryOffset + 12);

    chunks.push(img.png);
    currentOffset += img.png.length;
  });

  return Buffer.concat(chunks);
}

const ANDROID_FOREGROUND_VECTOR = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group
        android:scaleX="0.58"
        android:scaleY="0.58"
        android:translateX="25"
        android:translateY="25">
        <path
            android:fillColor="#F38020"
            android:pathData="${PATH_ORANGE}" />
        <path
            android:fillColor="#FFFFFF"
            android:pathData="${PATH_RIGHT}" />
    </group>
</vector>
`;

const ANDROID_MONOCHROME_VECTOR = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group
        android:scaleX="0.58"
        android:scaleY="0.58"
        android:translateX="25"
        android:translateY="25">
        <path
            android:fillColor="#FFFFFF"
            android:pathData="${PATH_ORANGE}" />
        <path
            android:fillColor="#FFFFFF"
            android:pathData="${PATH_RIGHT}" />
    </group>
</vector>
`;

const ANDROID_ADAPTIVE_ICON_XML = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`;

const ANDROID_BACKGROUND_COLOR_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#131313</color>
</resources>
`;

const IOS_ASSETS_CONTENTS_JSON = `{
  "info": {
    "author": "xcode",
    "version": 1
  }
}
`;

const IOS_APPICON_CONTENTS_JSON = `{
  "images": [
    {
      "filename": "icon-1024.png",
      "idiom": "universal",
      "platform": "ios",
      "size": "1024x1024"
    }
  ],
  "info": {
    "author": "xcode",
    "version": 1
  }
}
`;

// Single-scale universal imageset (the storyboard's imageView fixes the
// display size); the dark entry follows the system luminosity trait.
// Formatted as standard JSON (oxfmt), not Xcode's `"key" : value` style.
const IOS_SPLASH_CONTENTS_JSON = `{
  "images": [
    {
      "filename": "splash-logo-light.png",
      "idiom": "universal"
    },
    {
      "appearances": [
        {
          "appearance": "luminosity",
          "value": "dark"
        }
      ],
      "filename": "splash-logo-dark.png",
      "idiom": "universal"
    }
  ],
  "info": {
    "author": "xcode",
    "version": 1
  }
}
`;

export function generateAllLogoAssets(): void {
  console.log("Generating unified XBond logo assets...");

  const roundedSvg = createRoundedIconSvg();
  const circleSvg = createCircleIconSvg();
  const squareSvg = createSquareIconSvg();

  // 1. Dashboard & Shared Web assets (apps/dashboard/public)
  const dashPublic = path.join(ROOT, "apps/dashboard/public");
  fs.mkdirSync(path.join(dashPublic, "icons"), { recursive: true });
  fs.writeFileSync(path.join(dashPublic, "favicon.svg"), FAVICON_SVG);
  fs.writeFileSync(
    path.join(dashPublic, "icons/icon-192.png"),
    renderPng(roundedSvg, 192),
  );
  fs.writeFileSync(
    path.join(dashPublic, "icons/icon-512.png"),
    renderPng(roundedSvg, 512),
  );
  console.log("✓ Dashboard & Web assets generated");

  // 3. Desktop Tauri assets (src-tauri/icons)
  const desktopIcons = path.join(ROOT, "src-tauri/icons");
  fs.mkdirSync(desktopIcons, { recursive: true });
  const desktopPng512 = renderPng(roundedSvg, 512);
  fs.writeFileSync(path.join(desktopIcons, "icon.png"), desktopPng512);

  // Pack multi-size Windows ICO
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoImages = icoSizes.map((size) => ({
    size,
    png: renderPng(roundedSvg, size),
  }));
  fs.writeFileSync(path.join(desktopIcons, "icon.ico"), createIco(icoImages));

  // The Windows installer ships the same rounded mark with a download
  // badge in the corner: the app at a glance, still readable as a setup
  // binary in a file list.
  const installerIconSvg = roundedSvg.replace(
    "</svg>",
    `  <circle cx="78" cy="78" r="17" fill="#F38020" stroke="#131313" stroke-width="4" />
  <g stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M78 70v10M73.5 76l4.5 4.5L82.5 76M70 84h16" />
  </g>
</svg>`,
  );
  const installerImages = icoSizes.map((size) => ({
    size,
    png: renderPng(installerIconSvg, size),
  }));
  fs.writeFileSync(
    path.join(desktopIcons, "installer.ico"),
    createIco(installerImages),
  );

  // Build macOS ICNS via tauri icon in a temp directory
  try {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xbond-tauri-icon-"));
    const tauriRes = spawnSync(
      "pnpm",
      ["tauri", "icon", path.join(desktopIcons, "icon.png"), "-o", tmpDir],
      { cwd: ROOT, stdio: "pipe" },
    );
    if (
      tauriRes.status === 0 &&
      fs.existsSync(path.join(tmpDir, "icon.icns"))
    ) {
      fs.copyFileSync(
        path.join(tmpDir, "icon.icns"),
        path.join(desktopIcons, "icon.icns"),
      );
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(
      "Notice: tauri icon failed to update icon.icns (keeping existing):",
      err,
    );
  }
  console.log("✓ Desktop Tauri assets generated");

  // 4. Android launcher resources
  const resDir = path.join(ROOT, "src-tauri/gen/android/app/src/main/res");
  fs.mkdirSync(path.join(resDir, "values"), { recursive: true });
  fs.mkdirSync(path.join(resDir, "drawable"), { recursive: true });
  fs.mkdirSync(path.join(resDir, "mipmap-anydpi-v26"), { recursive: true });

  fs.writeFileSync(
    path.join(resDir, "values/ic_launcher_background.xml"),
    ANDROID_BACKGROUND_COLOR_XML,
  );
  fs.writeFileSync(
    path.join(resDir, "drawable/ic_launcher_foreground.xml"),
    ANDROID_FOREGROUND_VECTOR,
  );
  fs.writeFileSync(
    path.join(resDir, "drawable/ic_launcher_monochrome.xml"),
    ANDROID_MONOCHROME_VECTOR,
  );
  fs.writeFileSync(
    path.join(resDir, "mipmap-anydpi-v26/ic_launcher.xml"),
    ANDROID_ADAPTIVE_ICON_XML,
  );
  fs.writeFileSync(
    path.join(resDir, "mipmap-anydpi-v26/ic_launcher_round.xml"),
    ANDROID_ADAPTIVE_ICON_XML,
  );

  const androidDensities = [
    { name: "mdpi", size: 48 },
    { name: "hdpi", size: 72 },
    { name: "xhdpi", size: 96 },
    { name: "xxhdpi", size: 144 },
    { name: "xxxhdpi", size: 192 },
  ];

  for (const { name, size } of androidDensities) {
    const mipmapDir = path.join(resDir, `mipmap-${name}`);
    fs.mkdirSync(mipmapDir, { recursive: true });
    fs.writeFileSync(
      path.join(mipmapDir, "ic_launcher.png"),
      renderPng(roundedSvg, size),
    );
    fs.writeFileSync(
      path.join(mipmapDir, "ic_launcher_round.png"),
      renderPng(circleSvg, size),
    );
  }
  console.log("✓ Android assets generated");

  // 5. iOS launcher resources
  const iosAssetsDir = path.join(ROOT, "src-tauri/gen/apple/Assets.xcassets");
  const iosIconSetDir = path.join(iosAssetsDir, "AppIcon.appiconset");
  fs.mkdirSync(iosIconSetDir, { recursive: true });

  fs.writeFileSync(
    path.join(iosAssetsDir, "Contents.json"),
    IOS_ASSETS_CONTENTS_JSON,
  );
  fs.writeFileSync(
    path.join(iosIconSetDir, "Contents.json"),
    IOS_APPICON_CONTENTS_JSON,
  );

  // Render 1024x1024 solid #131313 square icon and strip alpha channel via ffmpeg if available
  const ios1024Png = renderPng(squareSvg, 1024);
  const targetIosPng = path.join(iosIconSetDir, "icon-1024.png");
  fs.writeFileSync(targetIosPng, ios1024Png);

  const ffmpegRes = spawnSync(
    "ffmpeg",
    ["-y", "-i", targetIosPng, "-pix_fmt", "rgb24", targetIosPng + ".tmp.png"],
    { stdio: "pipe" },
  );
  if (ffmpegRes.status === 0 && fs.existsSync(targetIosPng + ".tmp.png")) {
    fs.renameSync(targetIosPng + ".tmp.png", targetIosPng);
  } else if (fs.existsSync(targetIosPng + ".tmp.png")) {
    fs.rmSync(targetIosPng + ".tmp.png", { force: true });
  }

  // 6. iOS launch-screen glyph (SplashLogo.imageset, referenced by
  // gen/apple/LaunchScreen.storyboard): transparent-background brand mark,
  // one PNG per luminosity variant.
  const splashSetDir = path.join(iosAssetsDir, "SplashLogo.imageset");
  fs.mkdirSync(splashSetDir, { recursive: true });
  fs.writeFileSync(
    path.join(splashSetDir, "Contents.json"),
    IOS_SPLASH_CONTENTS_JSON,
  );
  fs.writeFileSync(
    path.join(splashSetDir, "splash-logo-light.png"),
    renderPng(SPLASH_LOGO_SVG_LIGHT, 512),
  );
  fs.writeFileSync(
    path.join(splashSetDir, "splash-logo-dark.png"),
    renderPng(SPLASH_LOGO_SVG_DARK, 512),
  );
  console.log("✓ iOS assets generated");

  console.log("All XBond logo assets generated successfully.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateAllLogoAssets();
}
