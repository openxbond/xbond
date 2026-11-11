import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { PATH_ORANGE, PATH_RIGHT } from "./build-logo-assets.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// Windows NSIS installer art (DESIGN.md "冷瓷与暖橙缎带"). The welcome/finish
// sidebar reuses the app icon canvas (#131313) with the dark theme's warm
// aurora; the header sits on the NSIS dialog background (#F0F0F0) with the
// light theme's peach aurora patch.
export const SIDEBAR_SIZE = { width: 164, height: 314 };
export const HEADER_SIZE = { width: 150, height: 57 };

export function createInstallerSidebarSvg(): string {
  return `<svg width="${SIDEBAR_SIZE.width}" height="${SIDEBAR_SIZE.height}" viewBox="0 0 ${SIDEBAR_SIZE.width} ${SIDEBAR_SIZE.height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="aurora-main">
      <stop offset="0" stop-color="#F7720D" stop-opacity="0.3" />
      <stop offset="0.45" stop-color="#F7720D" stop-opacity="0.1" />
      <stop offset="1" stop-color="#F7720D" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="aurora-top">
      <stop offset="0" stop-color="#FF914D" stop-opacity="0.12" />
      <stop offset="1" stop-color="#FF914D" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="164" height="314" fill="#131313" />
  <ellipse cx="46" cy="316" rx="150" ry="170" fill="url(#aurora-main)" />
  <ellipse cx="150" cy="6" rx="90" ry="80" fill="url(#aurora-top)" />
  <g transform="translate(36 42) scale(0.92)">
    <path d="${PATH_ORANGE}" fill="#F38020" />
    <path d="${PATH_RIGHT}" fill="#FFFFFF" />
  </g>
</svg>
`;
}

export function createInstallerHeaderSvg(): string {
  return `<svg width="${HEADER_SIZE.width}" height="${HEADER_SIZE.height}" viewBox="0 0 ${HEADER_SIZE.width} ${HEADER_SIZE.height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="aurora-peach">
      <stop offset="0" stop-color="#FFCDB5" stop-opacity="0.45" />
      <stop offset="1" stop-color="#FFCDB5" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="150" height="57" fill="#F0F0F0" />
  <ellipse cx="75" cy="30" rx="52" ry="34" fill="url(#aurora-peach)" />
  <g transform="translate(58 11) scale(0.34)">
    <rect width="100" height="100" rx="22" fill="#131313" />
    <path d="${PATH_ORANGE}" fill="#F38020" />
    <path d="${PATH_RIGHT}" fill="#FFFFFF" />
  </g>
</svg>
`;
}

/** Encode top-down RGB pixels as a bottom-up 24-bit uncompressed (BI_RGB) BMP. */
export function encodeBmp(rgb: Buffer, width: number, height: number): Buffer {
  const stride = (width * 3 + 3) & ~3;
  if (rgb.length !== width * height * 3) {
    throw new Error(
      `expected ${width * height * 3} RGB bytes, got ${rgb.length}`,
    );
  }

  const bmp = Buffer.alloc(54 + stride * height);
  bmp.write("BM", 0, "latin1");
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14); // BITMAPINFOHEADER
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22); // positive: bottom-up rows
  bmp.writeUInt16LE(1, 26); // color planes
  bmp.writeUInt16LE(24, 28); // bits per pixel
  bmp.writeUInt32LE(0, 30); // BI_RGB, no compression
  bmp.writeUInt32LE(stride * height, 34);
  bmp.writeUInt32LE(2835, 38); // 72 DPI
  bmp.writeUInt32LE(2835, 42);

  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 3;
    const dstRow = 54 + y * stride;
    for (let x = 0; x < width; x++) {
      bmp[dstRow + x * 3] = rgb[srcRow + x * 3 + 2]; // B
      bmp[dstRow + x * 3 + 1] = rgb[srcRow + x * 3 + 1]; // G
      bmp[dstRow + x * 3 + 2] = rgb[srcRow + x * 3]; // R
    }
  }
  return bmp;
}

async function renderBmp(
  svg: string,
  size: { width: number; height: number },
): Promise<Buffer> {
  const { data, info } = await sharp(Buffer.from(svg))
    .resize(size.width, size.height)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) {
    throw new Error(
      `expected 3 channels after removeAlpha, got ${info.channels}`,
    );
  }
  return encodeBmp(data, info.width, info.height);
}

export async function generateInstallerBitmaps(): Promise<void> {
  const icons = path.join(ROOT, "src-tauri/icons");
  fs.mkdirSync(icons, { recursive: true });
  const sidebar = await renderBmp(createInstallerSidebarSvg(), SIDEBAR_SIZE);
  const header = await renderBmp(createInstallerHeaderSvg(), HEADER_SIZE);
  fs.writeFileSync(path.join(icons, "installer-sidebar.bmp"), sidebar);
  fs.writeFileSync(path.join(icons, "installer-header.bmp"), header);
  console.log("✓ Installer bitmaps generated");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generateInstallerBitmaps();
}
