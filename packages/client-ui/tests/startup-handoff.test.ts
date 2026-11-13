import assert from "node:assert/strict";
import test from "node:test";

import { reportStartupSettled } from "../src/platform/startup-handoff.ts";

/**
 * Startup hand-off dispatch: the desktop shell listens on the app command,
 * Android on the xbond plugin command (its native splash keep-on-screen),
 * iOS/web have no splash object to report to.
 */
function withShell(userAgent: string | undefined, run: () => void): string[] {
  const commands: string[] = [];
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  try {
    globalThis.window = {
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          commands.push(command);
          return null;
        },
      },
    } as unknown as Window & typeof globalThis;
    if (userAgent !== undefined) {
      Object.defineProperty(globalThis, "navigator", {
        value: { userAgent, maxTouchPoints: 5 },
        configurable: true,
      });
    }

    run();
    return commands;
  } finally {
    Reflect.deleteProperty(globalThis, "window");
    if (navigatorDescriptor)
      Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  }
}

test("desktop shell receives startup_complete on the app command", () => {
  const commands = withShell(undefined, () => reportStartupSettled());
  assert.deepEqual(commands, ["startup_complete"]);
});

test("android shell receives startup_complete on the xbond plugin command", () => {
  const commands = withShell(
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36",
    () => reportStartupSettled(),
  );
  assert.deepEqual(commands, ["plugin:xbond|startup_complete"]);
});

test("ios shell has no splash object to report to", () => {
  const commands = withShell(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    () => reportStartupSettled(),
  );
  assert.deepEqual(commands, []);
});

test("plain browser host never invokes", () => {
  // No window at all: the report must be a silent no-op.
  Reflect.deleteProperty(globalThis, "window");
  assert.doesNotThrow(() => reportStartupSettled());
});
