import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The deb/rpm preRemove script must wipe everything on genuine removal but
// never touch data on upgrade: the package manager runs the same script with
// `upgrade` on that path, and the machine daemon self-updates otherwise.
const root = fileURLToPath(new URL("../..", import.meta.url));
const script = fs.readFileSync(
  path.join(root, "src-tauri/scripts/machine-daemon-preremove.sh"),
  "utf8",
);

test("preRemove only runs on genuine removal, never on upgrade", () => {
  assert.match(script, /case "\$1" in\nremove \| 0\) ;;\n\*\) exit 0 ;;?/);
  assert.match(script, /purge-user-data/);
  assert.match(script, /rm -rf \/var\/lib\/xbond-system/);
});
