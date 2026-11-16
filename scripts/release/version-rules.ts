import { releaseVersion } from "./release-version.ts";

// Version rules that broke a real candidate (Tauri's Linux bundle rejects a
// prerelease marketing version, and the shared build number feeds Apple,
// Android and Windows alike). `pnpm release:preview` runs these before it
// spends time building, so the answer arrives in seconds rather than after a
// failed 30-minute matrix.
export const MAX_BUILD = 99_999_999;

export function releaseProblems(tag: string): string[] {
  const { version, build, prerelease } = releaseVersion(tag);
  const marketing = version.replace(/-rc\.[0-9]+$/, "");
  const problems: string[] = [];
  if (!/^\d+\.\d+\.\d+$/.test(marketing))
    problems.push(`Bundle version ${marketing} is not numeric (Apple/deb/rpm)`);
  if (build > MAX_BUILD)
    problems.push(`Build number ${build} exceeds ${MAX_BUILD}`);
  if (prerelease && build % 100 === 99)
    problems.push(`Candidate ${tag} must not use the stable build slot`);
  if (!prerelease && build % 100 !== 99)
    problems.push(`Stable ${tag} must use the stable build slot`);
  return problems;
}
