import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { PATH_ORANGE, PATH_RIGHT } from "./build-logo-assets.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

export const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

export function createInstallerIconSvg(): string {
  return `<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="enamel" x1="0" y1="0" x2=".7" y2="1">
      <stop stop-color="#ED6A0C" />
      <stop offset="1" stop-color="#A84000" />
    </linearGradient>
  </defs>
  <rect x="10" y="10" width="236" height="236" rx="60" fill="url(#enamel)" />
  <rect x="12" y="12" width="232" height="232" rx="58" fill="none" stroke="#FFAC78" stroke-opacity=".7" stroke-width="3" />
  <g transform="translate(52 17) scale(1.52)">
    <path d="${PATH_ORANGE}" fill="#FFFFFF" />
    <path d="${PATH_RIGHT}" fill="#FFDCC6" />
  </g>
  <path d="M128 162V194M111 181L128 198L145 181M95 200V218H161V200" stroke="#FFF7F1" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none" />
</svg>
`;
}

async function renderIconRgba(size: number): Promise<Buffer> {
  const { data, info } = await sharp(Buffer.from(createInstallerIconSvg()))
    .resize(size, size)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) {
    throw new Error(
      `expected 4 channels after ensureAlpha, got ${info.channels}`,
    );
  }
  if (info.width !== size || info.height !== size) {
    throw new Error(
      `expected ${size}x${size}, got ${info.width}x${info.height}`,
    );
  }
  return data;
}

/** Pack ICO directory + 32-bit DIB entries (small sizes) and PNG entries
 * (128+; Vista and later read them everywhere else they are required). */
export function encodeIco(
  entries: { size: number; png?: Buffer; rgba?: Buffer }[],
): Buffer {
  const blobs = entries.map((entry) =>
    entry.png
      ? entry.png
      : encodeDib(
          entry.rgba ??
            (() => {
              throw new Error(`entry ${entry.size} needs png or rgba`);
            })(),
          entry.size,
        ),
  );
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dirs: Buffer[] = [];
  let offset = 6 + 16 * entries.length;
  entries.forEach((entry, index) => {
    const dir = Buffer.alloc(16);
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, 0);
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, 1);
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bits per pixel
    dir.writeUInt32LE(blobs[index].length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += blobs[index].length;
    dirs.push(dir);
  });
  return Buffer.concat([header, ...dirs, ...blobs]);
}

/** BITMAPINFOHEADER + bottom-up 32-bit BGRA + a zeroed 1bpp AND mask (the
 * alpha channel carries transparency). */
export function encodeDib(rgba: Buffer, size: number): Buffer {
  const stride = size * 4;
  const maskStride = ((size + 31) >> 5) << 2;
  const dib = Buffer.alloc(40 + stride * size + maskStride * size);
  dib.writeUInt32LE(40, 0); // BITMAPINFOHEADER length
  dib.writeInt32LE(size, 4);
  dib.writeInt32LE(size * 2, 8); // XOR + AND height
  dib.writeUInt16LE(1, 12); // planes
  dib.writeUInt16LE(32, 14); // bpp
  dib.writeUInt32LE(0, 16); // BI_RGB
  dib.writeUInt32LE(stride * size + maskStride * size, 20);
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * stride;
    const dstRow = 40 + y * stride;
    for (let x = 0; x < size; x++) {
      dib[dstRow + x * 4] = rgba[srcRow + x * 4 + 2]; // B
      dib[dstRow + x * 4 + 1] = rgba[srcRow + x * 4 + 1]; // G
      dib[dstRow + x * 4 + 2] = rgba[srcRow + x * 4]; // R
      dib[dstRow + x * 4 + 3] = rgba[srcRow + x * 4 + 3]; // A
    }
  }
  return dib;
}

export async function generateInstallerBitmaps(): Promise<void> {
  const icons = path.join(ROOT, "src-tauri/icons");
  fs.mkdirSync(icons, { recursive: true });
  const entries = await Promise.all(
    ICON_SIZES.map(async (size) => ({
      size,
      ...(size >= 128
        ? {
            png: await sharp(Buffer.from(createInstallerIconSvg()))
              .resize(size, size)
              .png()
              .toBuffer(),
          }
        : { rgba: await renderIconRgba(size) }),
    })),
  );
  fs.writeFileSync(path.join(icons, "installer.ico"), encodeIco(entries));
  console.log("✓ Windows installer icon generated");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generateInstallerBitmaps();
}
