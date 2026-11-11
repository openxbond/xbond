import assert from "node:assert/strict";
import test from "node:test";

import { PATH_ORANGE, PATH_RIGHT } from "./build-logo-assets.ts";
import {
  createInstallerHeaderSvg,
  createInstallerSidebarSvg,
  encodeBmp,
  HEADER_SIZE,
  SIDEBAR_SIZE,
} from "./generate-installer-bitmaps.ts";

test("installer sidebar art follows the dark aurora canvas language", () => {
  const svg = createInstallerSidebarSvg();
  assert.match(svg, new RegExp(PATH_ORANGE));
  assert.match(svg, new RegExp(PATH_RIGHT));
  assert.match(svg, /width="164" height="314"/);
  // App icon canvas with the dark theme's warm aurora.
  assert.match(svg, /fill="#131313"/);
  assert.match(svg, /#F7720D/);
  assert.match(svg, /#FF914D/);
});

test("installer header art blends with the NSIS dialog background", () => {
  const svg = createInstallerHeaderSvg();
  assert.match(svg, new RegExp(PATH_ORANGE));
  assert.match(svg, new RegExp(PATH_RIGHT));
  assert.match(svg, /width="150" height="57"/);
  // Dialog background with the light theme's peach aurora patch.
  assert.match(svg, /fill="#F0F0F0"/);
  assert.match(svg, /#FFCDB5/);
});

test("encodeBmp writes a bottom-up 24-bit BI_RGB payload", () => {
  // Top-down 2x2 RGB: top row red then green, bottom row blue then white.
  const rgb = Buffer.from([
    255,
    0,
    0,
    0,
    255,
    0, // row 0
    0,
    0,
    255,
    255,
    255,
    255, // row 1
  ]);
  const bmp = encodeBmp(rgb, 2, 2);

  assert.equal(bmp.toString("latin1", 0, 2), "BM");
  assert.equal(bmp.readUInt32LE(2), bmp.length);
  assert.equal(bmp.readUInt32LE(10), 54);
  assert.equal(bmp.readUInt32LE(14), 40);
  assert.equal(bmp.readInt32LE(18), 2);
  assert.equal(bmp.readInt32LE(22), 2);
  assert.equal(bmp.readUInt16LE(26), 1);
  assert.equal(bmp.readUInt16LE(28), 24);
  assert.equal(bmp.readUInt32LE(30), 0);

  // Bottom-up rows with BGR pixels: the first stored pixel is row 1 blue.
  assert.deepEqual([...bmp.subarray(54, 60)], [255, 0, 0, 255, 255, 255]);
  // Width 2 stores 6 bytes per row padded to 4-byte alignment.
  assert.equal(bmp.length, 54 + 2 * 8);
});

test("bitmaps match the NSIS-recommended dimensions", () => {
  assert.deepEqual(SIDEBAR_SIZE, { width: 164, height: 314 });
  assert.deepEqual(HEADER_SIZE, { width: 150, height: 57 });
});
