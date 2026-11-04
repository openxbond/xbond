import assert from "node:assert/strict";
import test from "node:test";

import { openExternalUrl } from "../src/platform/open-external.ts";

function mockWindow(win: unknown) {
  // @ts-expect-error Mock global window
  globalThis.window = win as unknown as Window & typeof globalThis;
}

function restoreWindow() {
  // @ts-expect-error Restore
  delete globalThis.window;
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
