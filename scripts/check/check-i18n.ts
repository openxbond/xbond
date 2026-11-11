import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface I18nProblem {
  file: string;
  key?: string;
  message: string;
}

export type LocaleDict = Record<string, unknown>;

const LOCALES = [
  {
    code: "en_US",
    file: "packages/client-ui/src/i18n/messages/en-us.ts",
    isBase: true,
  },
  { code: "zh_CN", file: "packages/client-ui/src/i18n/messages/zh-cn.ts" },
  { code: "zh_HK", file: "packages/client-ui/src/i18n/messages/zh-hk.ts" },
  { code: "ko", file: "packages/client-ui/src/i18n/messages/ko.ts" },
  { code: "fa", file: "packages/client-ui/src/i18n/messages/fa.ts" },
];

/**
 * Recursively flatten a nested dictionary into dot-separated paths.
 */
export function flattenDict(obj: unknown, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  if (!obj || typeof obj !== "object") return result;

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      result.set(fullKey, value);
    } else if (typeof value === "object" && value !== null) {
      const nested = flattenDict(value, fullKey);
      for (const [k, v] of nested) {
        result.set(k, v);
      }
    }
  }
  return result;
}

/**
 * Extract interpolation variable tokens like {{var}} from a template string.
 */
export function extractInterpolationTokens(str: string): string[] {
  const matches = str.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.replace(/[{}]/g, "").trim()))].sort();
}

/**
 * Check if string has broken single-brace template syntax like {variable} instead of {{variable}}.
 */
export function hasBrokenBraces(str: string): string | null {
  // Matches {word} but not {{word}}
  const broken = str.match(/(?<!\{)\{([a-zA-Z0-9_]+)\}(?!\})/);
  return broken ? broken[0] : null;
}

/**
 * Check UI files for common unlocalized hardcoded text in JSX attributes.
 */
export function checkHardcodedAttributes(rootDir: string): I18nProblem[] {
  const problems: I18nProblem[] = [];
  const uiSrc = path.join(rootDir, "packages/client-ui/src");

  if (!fs.existsSync(uiSrc)) return problems;

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === "i18n" ||
          entry.name === "styles" ||
          entry.name === "icons"
        )
          continue;
        walk(full);
      } else if (
        entry.isFile() &&
        /\.(tsx)$/.test(entry.name) &&
        !entry.name.endsWith(".test.tsx")
      ) {
        const content = fs.readFileSync(full, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes("i18n-ignore")) continue;

          // Check for hardcoded Chinese characters in aria-label="..." or placeholder="..."
          const matchAria = line.match(
            /aria-label=["']([^"']*[\u4e00-\u9fff][^"']*)["']/,
          );
          if (matchAria) {
            problems.push({
              file: path.relative(rootDir, full),
              message: `Line ${i + 1}: hardcoded non-localized text in aria-label="${matchAria[1]}"`,
            });
          }

          const matchPlaceholder = line.match(
            /placeholder=["']([^"']*[\u4e00-\u9fff][^"']*)["']/,
          );
          if (matchPlaceholder) {
            problems.push({
              file: path.relative(rootDir, full),
              message: `Line ${i + 1}: hardcoded non-localized text in placeholder="${matchPlaceholder[1]}"`,
            });
          }
        }
      }
    }
  }

  walk(uiSrc);
  return problems;
}

/**
 * Verify desktop tray i18n completeness in src-tauri/src/tray.rs.
 */
export function checkTrayI18n(rootDir: string): I18nProblem[] {
  const problems: I18nProblem[] = [];
  const trayPath = path.join(rootDir, "src-tauri/src/tray.rs");

  if (!fs.existsSync(trayPath)) return problems;

  const content = fs.readFileSync(trayPath, "utf8");
  const requiredLocales = ["ZH_HK", "ZH_CN", "EN_US", "KO", "FA"];

  for (const loc of requiredLocales) {
    if (
      !content.includes(`const ${loc}: TrayI18n`) &&
      !content.includes(`static ${loc}: TrayI18n`)
    ) {
      problems.push({
        file: "src-tauri/src/tray.rs",
        message: `Missing tray i18n definition for locale '${loc}'`,
      });
    }
  }

  return problems;
}

/**
 * Main i18n checker runner.
 */
export async function checkI18n(rootDir: string): Promise<I18nProblem[]> {
  const problems: I18nProblem[] = [];

  // 1. Load base locale (en_US)
  const baseDef = LOCALES.find((l) => l.isBase)!;
  const basePath = path.join(rootDir, baseDef.file);

  if (!fs.existsSync(basePath)) {
    problems.push({
      file: baseDef.file,
      message: "Base locale file not found",
    });
    return problems;
  }

  const baseModule = await import(pathToFileURL(basePath).href);
  const baseDict = (baseModule.default ?? baseModule) as LocaleDict;
  const baseMap = flattenDict(baseDict);

  // 2. Validate all target locales against base
  for (const loc of LOCALES) {
    const locPath = path.join(rootDir, loc.file);
    if (!fs.existsSync(locPath)) {
      problems.push({
        file: loc.file,
        message: `Locale file for '${loc.code}' not found`,
      });
      continue;
    }

    const locModule = await import(pathToFileURL(locPath).href);
    const locDict = (locModule.default ?? locModule) as LocaleDict;
    const locMap = flattenDict(locDict);

    // Check missing keys
    for (const [key, baseVal] of baseMap) {
      if (!locMap.has(key)) {
        problems.push({
          file: loc.file,
          key,
          message: `Missing translation key: '${key}'`,
        });
        continue;
      }

      const val = locMap.get(key)!.trim();
      if (!val) {
        problems.push({
          file: loc.file,
          key,
          message: `Translation string is empty for key: '${key}'`,
        });
        continue;
      }

      // Check broken interpolation syntax
      const broken = hasBrokenBraces(val);
      if (broken) {
        problems.push({
          file: loc.file,
          key,
          message: `Invalid single-brace interpolation '${broken}' (must be '{{...}}') in key: '${key}'`,
        });
      }

      // Check interpolation token consistency
      const baseTokens = extractInterpolationTokens(baseVal);
      const locTokens = extractInterpolationTokens(val);
      for (const token of baseTokens) {
        if (!locTokens.includes(token)) {
          problems.push({
            file: loc.file,
            key,
            message: `Missing required interpolation token '{{${token}}}' in key: '${key}'`,
          });
        }
      }
    }

    // Check extra / orphaned keys
    for (const key of locMap.keys()) {
      if (!baseMap.has(key)) {
        problems.push({
          file: loc.file,
          key,
          message: `Orphaned/extra translation key not present in en_US: '${key}'`,
        });
      }
    }
  }

  // 3. Check for hardcoded attributes in UI
  const attrProblems = checkHardcodedAttributes(rootDir);
  problems.push(...attrProblems);

  // 4. Check desktop tray i18n
  const trayProblems = checkTrayI18n(rootDir);
  problems.push(...trayProblems);

  return problems;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const rootDir = fileURLToPath(new URL("../..", import.meta.url));
  const problems = await checkI18n(rootDir);

  if (problems.length > 0) {
    console.error(
      `\n❌ i18n gate check failed with ${problems.length} problem(s):\n`,
    );
    for (const p of problems) {
      const keyInfo = p.key ? ` [${p.key}]` : "";
      console.error(`  - ${p.file}${keyInfo}: ${p.message}`);
    }
    console.error("");
    process.exitCode = 1;
  } else {
    console.log(
      `✔ i18n check passed: 5 locales verified across all message keys, tokens, and UI attributes.`,
    );
  }
}
