import assert from "node:assert/strict";
import test from "node:test";

import { saveTextFile } from "../src/platform/save-file.ts";

function mockWindow(win: unknown) {
  globalThis.window = win as unknown as Window & typeof globalThis;
}

function restoreWindow() {
  Reflect.deleteProperty(globalThis, "window");
}

test("saveTextFile hands the content to the shell command on desktop", async () => {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  mockWindow({
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        return true;
      },
    },
  });
  try {
    const saved = await saveTextFile("{}", "xbond-bugreport.json", "JSON", [
      "json",
    ]);
    assert.equal(saved, true);
    assert.deepEqual(calls, [
      {
        cmd: "save_text_file",
        args: {
          contents: "{}",
          fileName: "xbond-bugreport.json",
          filterName: "JSON",
          extensions: ["json"],
        },
      },
    ]);
  } finally {
    restoreWindow();
  }
});

test("saveTextFile rejects inside a mobile Tauri shell instead of doing nothing", async () => {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  mockWindow({
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        return true;
      },
    },
  });
  // host.ts reads the global navigator; override it with an Android UA.
  const realNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", {
    value: {
      userAgent: "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36",
    },
    configurable: true,
  });
  try {
    await assert.rejects(() =>
      saveTextFile("{}", "xbond-bugreport.json", "JSON", ["json"]),
    );
    assert.deepEqual(calls, []);
  } finally {
    Object.defineProperty(globalThis, "navigator", {
      value: realNavigator,
      configurable: true,
    });
    restoreWindow();
  }
});

test("saveTextFile falls back to the blob download in plain browsers", async () => {
  const downloads: Array<{
    href?: string;
    download?: string;
    clicked: boolean;
  }> = [];
  const revoked: string[] = [];
  const realCreateObjectURL = URL.createObjectURL;
  const realRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:mock-report";
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
  (globalThis as { document?: unknown }).document = {
    createElement: () => {
      const a: { href?: string; download?: string; clicked: boolean } = {
        clicked: false,
      };
      Object.defineProperty(a, "click", {
        value: () => {
          a.clicked = true;
        },
      });
      downloads.push(a);
      return a;
    },
  };
  try {
    const saved = await saveTextFile("log text", "xbond-logs.txt", "Text", [
      "txt",
    ]);
    assert.equal(saved, true);
    assert.deepEqual(downloads, [
      {
        href: "blob:mock-report",
        download: "xbond-logs.txt",
        clicked: true,
      },
    ]);
    assert.deepEqual(revoked, []);
  } finally {
    URL.createObjectURL = realCreateObjectURL;
    URL.revokeObjectURL = realRevokeObjectURL;
    Reflect.deleteProperty(globalThis, "document");
    restoreWindow();
  }
});
