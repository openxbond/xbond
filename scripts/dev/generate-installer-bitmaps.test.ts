import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("shipped installer icon keeps the NSIS size set", () => {
  const ico = readFileSync(
    new URL("../../src-tauri/icons/installer.ico", import.meta.url),
  );
  // ICONDIR: reserved, type 1 (icon), 7 entries.
  assert.deepEqual([...ico.subarray(0, 6)], [0, 0, 1, 0, 7, 0]);
  for (const [index, size] of [
    [0, 16],
    [6, 256],
  ] as const) {
    const entry = 6 + index * 16;
    const width = ico.readUInt8(entry) || 256;
    assert.equal(width, size);
    // 32bpp BGRA payload.
    assert.equal(ico.readUInt16LE(entry + 6), 32);
  }
});
