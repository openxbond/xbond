import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Single source of the Go build tags: every go invocation must run against the
// same feature set, and the gomobile binds in scripts/mobile.ts consume this
// too, so a tag can never drift between the CLI and the mobile bindings.
export const BUILD_TAGS = "with_gvisor,with_quic,with_utls,with_clash_api";

// Every Go package tree in the module. gofmt walks these raw because
// `go fmt` would skip the tagged files without the build tags.
const GO_DIRS = ["cmd", "internal", "mobile"];

export type GoInvocation = { file: string; args: string[] };

// Pure seam for tests: assembles the argv for one subcommand; extra args are
// appended verbatim (pnpm forwards everything after the script name).
export function goCommand(command: string, extra: string[] = []): GoInvocation {
  switch (command) {
    case "build":
      return {
        file: "go",
        args: ["build", "-tags", BUILD_TAGS, "./cmd/xbond", ...extra],
      };
    case "run":
      return {
        file: "go",
        args: ["run", "-tags", BUILD_TAGS, "./cmd/xbond", ...extra],
      };
    case "test":
      return {
        file: "go",
        args: ["test", "-tags", BUILD_TAGS, "./...", ...extra],
      };
    case "vet":
      return {
        file: "go",
        args: ["vet", "-tags", BUILD_TAGS, "./...", ...extra],
      };
    case "fmt":
      return { file: "gofmt", args: ["-w", ...GO_DIRS, ...extra] };
    case "fmt:check":
      return { file: "gofmt", args: ["-l", ...GO_DIRS, ...extra] };
    default:
      throw new Error(`unknown go command: ${command}`);
  }
}

function run(invocation: GoInvocation): boolean {
  const res = spawnSync(invocation.file, invocation.args, { stdio: "inherit" });
  return res.status === 0;
}

// gofmt -l exits 0 even when files need formatting, so the check reads stdout.
function runFmtCheck(): boolean {
  const res = spawnSync("gofmt", ["-l", ...GO_DIRS], { stdio: "pipe" });
  if (res.status !== 0) {
    console.error(`[go:fmt:check] gofmt failed: ${res.stderr?.toString()}`);
    return false;
  }
  const unformatted = res.stdout?.toString().trim() ?? "";
  if (unformatted) {
    console.error(
      `[go:fmt:check] unformatted files (run "pnpm cli:fmt"):\n${unformatted}`,
    );
    return false;
  }
  return true;
}

const USAGE =
  "Usage: node scripts/go.ts [build|run|test|vet|fmt|fmt:check|check] [extra args...]";

function main(): void {
  // pnpm appends script arguments verbatim, `--` included when someone writes
  // `pnpm cli:run -- version`; no go command consumes a bare `--`.
  const [command, ...extra] = process.argv.slice(2).filter((a) => a !== "--");

  if (command === "check") {
    for (const step of ["vet", "test", "build"]) {
      if (!run(goCommand(step))) {
        console.error(`[go:check] ${step} failed`);
        process.exit(1);
      }
    }
    return;
  }

  if (command === "fmt:check") {
    process.exit(runFmtCheck() ? 0 : 1);
  }

  if (!command || !["build", "run", "test", "vet", "fmt"].includes(command)) {
    console.error(USAGE);
    process.exit(1);
  }

  process.exit(run(goCommand(command, extra)) ? 0 : 1);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main();
}
