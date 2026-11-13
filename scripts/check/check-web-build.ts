import { statSync } from "node:fs";

const entry = new URL("../../dist/web/index.html", import.meta.url);
if (statSync(entry).size === 0) throw new Error("Empty dist/web/index.html");
