import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkArchitecture } from "./check-architecture.ts";

function fixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xbond-architecture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function write(file: string, content: string) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        paths: {
          "@xbond/client/*": ["packages/client/src/*.ts"],
          "@xbond/client-ui/bootstrap": ["packages/client-ui/src/index.ts"],
        },
      },
    }),
  );
  write(
    "packages/client/package.json",
    JSON.stringify({
      name: "@xbond/client",
      exports: { "./value": "./src/value.ts" },
    }),
  );
  write(
    "packages/client-ui/package.json",
    JSON.stringify({
      name: "@xbond/client-ui",
      exports: { "./bootstrap": "./src/index.ts" },
      dependencies: { "@xbond/client": "workspace:*" },
    }),
  );
  write(
    "apps/dashboard/package.json",
    JSON.stringify({
      name: "@xbond/dashboard",
      dependencies: { "@xbond/client-ui": "workspace:*" },
    }),
  );
  write("packages/client/src/value.ts", "export const value = 1;");
  write(
    "packages/client-ui/src/index.ts",
    'export { value } from "@xbond/client/value";',
  );
  write("apps/dashboard/src/index.ts", 'import "@xbond/client-ui/bootstrap";');
  return { root, write };
}

test("host entries consume shared packages through declared exports", (t) => {
  const { root } = fixture(t);
  assert.deepEqual(checkArchitecture(root), []);
});

test("relative imports cannot hide a reverse dependency or a package cycle", (t) => {
  const { root, write } = fixture(t);
  write(
    "packages/client/src/value.ts",
    'export { value } from "../../client-ui/src/index.ts";',
  );
  const errors = checkArchitecture(root).join("\n");
  assert.match(errors, /forbidden dependency/);
  assert.match(errors, /declared package export/);
  assert.match(errors, /Package dependency cycle/);
});

test("dynamic imports cannot bypass package exports", (t) => {
  const { root, write } = fixture(t);
  write(
    "packages/client-ui/src/index.ts",
    'export const load = () => import("@xbond/client/private");',
  );
  assert.match(checkArchitecture(root).join("\n"), /declared package export/);
});

test("React dependencies and host bootstrap stay outside the shared client", (t) => {
  const { root, write } = fixture(t);
  write(
    "packages/client/src/value.ts",
    'import "react"; export const value = typeof window !== "undefined" && document.title;',
  );
  const errors = checkArchitecture(root).join("\n");
  assert.match(errors, /React and UI state/);
  assert.match(errors, /host bootstrap window/);
  assert.match(errors, /host bootstrap document/);
});
