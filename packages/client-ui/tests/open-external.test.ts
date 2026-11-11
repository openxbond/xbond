import assert from "node:assert/strict";
import test from "node:test";

import { openExternalUrl } from "../src/platform/open-external.ts";

function mockWindow(win: unknown) {
  globalThis.window = win as unknown as Window & typeof globalThis;
}

function restoreWindow() {
  Reflect.deleteProperty(globalThis, "window");
}

test("openExternalUrl hands the URL to the shell command on desktop", async () => {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  mockWindow({
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
      },
    },
  });
  try {
    await openExternalUrl("https://www.xbond.net/dash");
    assert.deepEqual(calls, [
      { cmd: "open_external_url", args: { url: "https://www.xbond.net/dash" } },
    ]);
  } finally {
    restoreWindow();
  }
});

test("openExternalUrl falls back to window.open outside the desktop shell", async () => {
  const opened: string[] = [];
  mockWindow({
    open: (url: string) => {
      opened.push(url);
    },
  });
  try {
    await openExternalUrl("https://www.xbond.net/dash");
    assert.deepEqual(opened, ["https://www.xbond.net/dash"]);
  } finally {
    restoreWindow();
  }
});

test("openExternalUrl delegates to XBondAndroid.openURL inside Android host", async () => {
  const opened: string[] = [];
  mockWindow({
    XBondAndroid: {
      openURL: (url: string) => {
        opened.push(url);
        return true;
      },
    },
  });
  try {
    await openExternalUrl("https://www.xbond.net/dash");
    assert.deepEqual(opened, ["https://www.xbond.net/dash"]);
  } finally {
    restoreWindow();
  }
});

test("openExternalUrl delegates to XBondIOS.openURL inside iOS host when available", async () => {
  const opened: string[] = [];
  mockWindow({
    XBondIOS: {
      openURL: (url: string) => {
        opened.push(url);
        return true;
      },
    },
  });
  try {
    await openExternalUrl("https://www.xbond.net/dash");
    assert.deepEqual(opened, ["https://www.xbond.net/dash"]);
  } finally {
    restoreWindow();
  }
});

test("openExternalUrl navigates the frame inside the iOS host", async () => {
  const navigated: string[] = [];
  mockWindow({
    XBondIOS: true,
    location: {
      set href(value: string) {
        navigated.push(value);
      },
    },
  });
  try {
    await openExternalUrl("https://www.xbond.net/dash");
    assert.deepEqual(navigated, ["https://www.xbond.net/dash"]);
  } finally {
    restoreWindow();
  }
});
