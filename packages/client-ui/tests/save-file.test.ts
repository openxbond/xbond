import assert from "node:assert/strict";
import test from "node:test";

import { saveTextFile, shareTextFile } from "../src/platform/save-file.ts";

function mockWindow(win: unknown) {
  globalThis.window = win as unknown as Window & typeof globalThis;
}

function restoreWindow() {
  Reflect.deleteProperty(globalThis, "window");
}

function mockAndroidNavigator() {
  const realNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", {
    value: {
      userAgent: "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36",
    },
    configurable: true,
  });
  return () =>
    Object.defineProperty(globalThis, "navigator", {
      value: realNavigator,
      configurable: true,
    });
}

test("saveTextFile hands the content to the desktop shell command", async () => {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  mockWindow({
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        return true;
      },
    },
  });
  const restoreNav = mockAndroidNavigator();
  // desktop detection: Tauri runtime but not mobile? isMobileApp true on Android UA,
  // so simulate desktop by using non-mobile UA.
  restoreNav();
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

test("saveTextFile uses the mobile plugin on Android", async () => {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  mockWindow({
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        return true;
      },
    },
  });
  const restoreNav = mockAndroidNavigator();
  try {
    const saved = await saveTextFile(
      "{}",
      "xbond-bugreport.json",
      "JSON",
      ["json"],
      "application/json",
    );
    assert.equal(saved, true);
    assert.deepEqual(calls, [
      {
        cmd: "plugin:xbond|save_text_file",
        args: {
          contents: "{}",
          fileName: "xbond-bugreport.json",
          mimeType: "application/json",
        },
      },
    ]);
  } finally {
    restoreNav();
    restoreWindow();
  }
});

test("shareTextFile uses the mobile plugin on Android", async () => {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  mockWindow({
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        return true;
      },
    },
  });
  const restoreNav = mockAndroidNavigator();
  try {
    const shared = await shareTextFile("log", "xbond-logs.txt", "text/plain");
    assert.equal(shared, true);
    assert.deepEqual(calls, [
      {
        cmd: "plugin:xbond|share_text_file",
        args: {
          contents: "log",
          fileName: "xbond-logs.txt",
          mimeType: "text/plain",
        },
      },
    ]);
  } finally {
    restoreNav();
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
