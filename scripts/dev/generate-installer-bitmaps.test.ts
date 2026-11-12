import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { encodeBmp } from "./generate-installer-bitmaps.ts";

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

test("shipped installer bitmaps match the NSIS controls", () => {
  for (const [name, width, height] of [
    ["sidebar", 164, 314],
    ["header", 150, 57],
    ["welcome", 498, 628],
  ] as const) {
    const bmp = readFileSync(
      new URL(`../../src-tauri/icons/installer-${name}.bmp`, import.meta.url),
    );
    assert.equal(bmp.toString("latin1", 0, 2), "BM");
    assert.equal(bmp.readInt32LE(18), width);
    assert.equal(bmp.readInt32LE(22), height);
    assert.equal(bmp.readUInt16LE(28), 24);
  }
});
