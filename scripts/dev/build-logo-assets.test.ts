import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createCircleIconSvg,
  createIco,
  createRoundedIconSvg,
  createSquareIconSvg,
  FAVICON_SVG,
  LOGO_SVG,
  PATH_ORANGE,
  PATH_RIGHT,
} from "./build-logo-assets.ts";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

test("canonical brand paths and vector assets include correct geometry and colors", () => {
  assert.match(LOGO_SVG, new RegExp(PATH_ORANGE));
  assert.match(LOGO_SVG, new RegExp(PATH_RIGHT));
  assert.match(LOGO_SVG, /fill="#F38020"/);

  assert.match(FAVICON_SVG, /prefers-color-scheme:\s*dark/);
  assert.match(FAVICON_SVG, /#F38020/);

  const rounded = createRoundedIconSvg(22);
  assert.match(rounded, /rx="22"/);
  assert.match(rounded, /fill="#131313"/);

  const circle = createCircleIconSvg(0.78);
  assert.match(circle, /<circle cx="50" cy="50" r="50"/);

  const square = createSquareIconSvg();
  assert.match(square, /<rect width="100" height="100" fill="#131313"\s*\/>/);
});

test("createIco builds valid multi-resolution Windows ICO headers", () => {
  const dummy16 = Buffer.alloc(10, 0xaa);
  const dummy32 = Buffer.alloc(20, 0xbb);

  const ico = createIco([
    { size: 16, png: dummy16 },
    { size: 32, png: dummy32 },
  ]);

  // Reserved = 0 (2B), Type = 1 (2B), Count = 2 (2B)
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 2);

  // Directory entry 0 (16x16)
  assert.equal(ico.readUInt8(6), 16);
  assert.equal(ico.readUInt8(7), 16);
  assert.equal(ico.readUInt32LE(14), dummy16.length);

  // Directory entry 1 (32x32)
  assert.equal(ico.readUInt8(22), 32);
  assert.equal(ico.readUInt8(23), 32);
  assert.equal(ico.readUInt32LE(30), dummy32.length);
});

test("verified all platform icon assets are present and properly declared", () => {
  // Dashboard & Web
  assert.ok(
    fs.existsSync(path.join(root, "apps/dashboard/public/favicon.svg")),
  );
  assert.ok(
    fs.existsSync(path.join(root, "apps/dashboard/public/icons/icon-192.png")),
  );
  assert.ok(
    fs.existsSync(path.join(root, "apps/dashboard/public/icons/icon-512.png")),
  );

  // Desktop (Tauri)
  assert.ok(fs.existsSync(path.join(root, "src-tauri/icons/icon.png")));
  assert.ok(fs.existsSync(path.join(root, "src-tauri/icons/icon.ico")));
  assert.ok(fs.existsSync(path.join(root, "src-tauri/icons/icon.icns")));

  // Android (Tauri gen launcher icons; see docs/specs/mobile-android.md)
  const resDir = path.join(root, "src-tauri/gen/android/app/src/main/res");
  assert.ok(
    fs.existsSync(path.join(resDir, "values/ic_launcher_background.xml")),
  );
  assert.ok(
    fs.existsSync(path.join(resDir, "drawable/ic_launcher_foreground.xml")),
  );
  assert.ok(
    fs.existsSync(path.join(resDir, "drawable/ic_launcher_monochrome.xml")),
  );
  assert.ok(
    fs.existsSync(path.join(resDir, "mipmap-anydpi-v26/ic_launcher.xml")),
  );
  assert.ok(
    fs.existsSync(path.join(resDir, "mipmap-anydpi-v26/ic_launcher_round.xml")),
  );

  for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
    assert.ok(
      fs.existsSync(path.join(resDir, `mipmap-${density}/ic_launcher.png`)),
    );
    assert.ok(
      fs.existsSync(
        path.join(resDir, `mipmap-${density}/ic_launcher_round.png`),
      ),
    );
  }

  // Android Manifest declaration
  const manifest = fs.readFileSync(
    path.join(root, "src-tauri/gen/android/app/src/main/AndroidManifest.xml"),
    "utf8",
  );
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);

  // iOS app icon in the generated project catalog
  const appIcon = path.join(
    root,
    "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/icon-1024.png",
  );
  assert.ok(fs.existsSync(appIcon));
});
