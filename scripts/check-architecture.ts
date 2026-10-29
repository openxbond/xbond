import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseSync, Visitor } from "oxc-parser";

function sourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const location = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(location)
      : /\.(?:ts|tsx)$/.test(entry.name)
        ? [location]
        : [];
  });
}
function inside(file: string, directory: string) {
  const relative = path.relative(directory, file);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}
type Manifest = {
  name: string;
  dependencies?: Record<string, string>;
  exports?: Record<string, string>;
};

export function checkArchitecture(root: string): string[] {
  const problems: string[] = [];
  const config: { compilerOptions?: { paths?: Record<string, string[]> } } =
    JSON.parse(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8"));
  const projects = ["apps", "packages"].flatMap((group) => {
    const directory = path.join(root, group);
    return fs.existsSync(directory)
      ? fs
          .readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(directory, entry.name))
          .filter((project) =>
            fs.existsSync(path.join(project, "package.json")),
          )
          .map((project) => ({
            directory: project,
            manifest: JSON.parse(
              fs.readFileSync(path.join(project, "package.json"), "utf8"),
            ) as Manifest,
          }))
      : [];
  });
  function resolveImport(specifier: string, file: string) {
    if (specifier.startsWith("."))
      return path.resolve(path.dirname(file), specifier);
    for (const [alias, targets] of Object.entries(
      config.compilerOptions?.paths ?? {},
    )) {
      const [prefix, suffix] = alias.split("*");
      if (
        suffix === undefined
          ? specifier === alias
          : specifier.startsWith(prefix) && specifier.endsWith(suffix)
      ) {
        const wildcard =
          suffix === undefined
            ? ""
            : specifier.slice(prefix.length, specifier.length - suffix.length);
        return path.resolve(root, targets[0].replace("*", wildcard));
      }
    }
    const project = projects.find(
      ({ manifest }) =>
        specifier === manifest.name ||
        specifier.startsWith(manifest.name + "/"),
    );
    const exported =
      project?.manifest.exports?.[
        specifier === project.manifest.name
          ? "."
          : "." + specifier.slice(project.manifest.name.length)
      ];
    return project && exported
      ? path.resolve(project.directory, exported)
      : undefined;
  }
  const edges = new Map<string, Set<string>>();
  for (const project of projects)
    for (const file of sourceFiles(path.join(project.directory, "src"))) {
      const label = path.relative(root, file).replaceAll("\\", "/");
      const parsed = parseSync(file, fs.readFileSync(file, "utf8"));
      if (parsed.errors.length) {
        problems.push(
          ...parsed.errors.map((error) => `${label}: ${error.message}`),
        );
        continue;
      }
      const imports: string[] = [];
      new Visitor({
        ImportDeclaration(node) {
          imports.push(node.source.value);
        },
        ExportNamedDeclaration(node) {
          if (node.source) imports.push(node.source.value);
        },
        ExportAllDeclaration(node) {
          imports.push(node.source.value);
        },
        ImportExpression(node) {
          if (
            node.source.type === "Literal" &&
            typeof node.source.value === "string"
          )
            imports.push(node.source.value);
        },
        MemberExpression(node) {
          if (
            project.manifest.name === "@xbond/client" &&
            node.object.type === "Identifier" &&
            ["window", "document", "localStorage", "chrome"].includes(
              node.object.name,
            )
          )
            problems.push(
              `${label}: host bootstrap ${node.object.name} belongs in a host adapter`,
            );
        },
        UnaryExpression(node) {
          if (
            project.manifest.name === "@xbond/client" &&
            node.operator === "typeof" &&
            node.argument.type === "Identifier" &&
            ["window", "document", "localStorage", "chrome"].includes(
              node.argument.name,
            )
          )
            problems.push(
              `${label}: host bootstrap ${node.argument.name} belongs in a host adapter`,
            );
        },
      }).visit(parsed.program);
      for (const specifier of imports) {
        if (
          project.manifest.name === "@xbond/client" &&
          /^(?:react(?:-dom|-i18next)?|jotai(?:-immer)?)(?:\/|$)/.test(
            specifier,
          )
        ) {
          problems.push(`${label}: React and UI state belong in client-ui`);
        }
        const resolved = resolveImport(specifier, file);
        const target =
          resolved &&
          projects.find((candidate) => inside(resolved, candidate.directory));
        if (target && target !== project) {
          const dependencies =
            edges.get(project.manifest.name) ?? new Set<string>();
          dependencies.add(target.manifest.name);
          edges.set(project.manifest.name, dependencies);
          if (
            project.manifest.name === "@xbond/client" ||
            inside(target.directory, path.join(root, "apps"))
          )
            problems.push(
              `${label}: forbidden dependency ${project.manifest.name} -> ${target.manifest.name}`,
            );
          const suffix =
            specifier === target.manifest.name
              ? "."
              : "." + specifier.slice(target.manifest.name.length);
          if (
            !specifier.startsWith(target.manifest.name + "/") ||
            !Object.hasOwn(target.manifest.exports ?? {}, suffix)
          )
            problems.push(
              `${label}: import ${specifier} through a declared package export`,
            );
        }
        if (
          specifier.startsWith("@xbond/") ||
          (!specifier.startsWith(".") &&
            !specifier.startsWith("node:") &&
            !resolved &&
            specifier !== "uno.css")
        ) {
          const name = specifier.startsWith("@")
            ? specifier.split("/").slice(0, 2).join("/")
            : specifier.split("/")[0];
          if (!project.manifest.dependencies?.[name])
            problems.push(
              `${label}: ${name} is not a dependency of ${project.manifest.name}`,
            );
          if (specifier.startsWith("@xbond/") && !target)
            problems.push(`${label}: unknown workspace import ${specifier}`);
        }
      }
    }
  function visit(name: string, ancestors: string[]) {
    if (ancestors.includes(name)) {
      problems.push(
        `Package dependency cycle: ${[...ancestors, name].join(" -> ")}`,
      );
      return;
    }
    for (const dependency of edges.get(name) ?? [])
      visit(dependency, [...ancestors, name]);
  }
  for (const name of edges.keys()) visit(name, []);
  return [...new Set(problems)];
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const problems = checkArchitecture(
    fileURLToPath(new URL("..", import.meta.url)),
  );
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
  } else
    console.log(
      "Architecture: apps -> client-ui -> client; package exports and dependencies verified.",
    );
}
