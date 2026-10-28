import type { Proxy } from "./request.ts";

export interface LatencyResult {
  status: "testing" | "ok" | "failed" | "timedOut" | "untested";
  delay?: number;
}

/**
 * Latency is a data signal strictly conforming to DESIGN.md thresholds:
 * < 150ms green (success), 150-400ms amber (warning), > 400ms red (destructive),
 * non-positive or untested neutral gray.
 */
export function delayToneClass(ms: number) {
  if (ms <= 0) return "bg-muted text-muted-foreground";
  if (ms < 150) return "bg-success text-success-foreground";
  if (ms <= 400) return "bg-warning text-warning-foreground";
  return "bg-destructive text-destructive-foreground";
}

/**
 * Compares two proxies in descending order of latency, accounting for real-time test results.
 */
export function compareDesc(
  a: Proxy,
  b: Proxy,
  results?: Record<string, { delay?: number; status?: string }>,
) {
  const lastDelayA = a.history.length > 0 ? a.history.slice(-1)[0].delay : 0;
  const lastDelayB = b.history.length > 0 ? b.history.slice(-1)[0].delay : 0;
  const realA = results?.[a.name]?.delay ?? lastDelayA;
  const realB = results?.[b.name]?.delay ?? lastDelayB;
  const delayA = a.alive === false ? 0 : realA;
  const delayB = b.alive === false ? 0 : realB;
  return (
    (delayB || Number.MAX_SAFE_INTEGER) - (delayA || Number.MAX_SAFE_INTEGER)
  );
}

export function validLatencyOptions(url: string, timeout: number) {
  try {
    return (
      new URL(url).protocol === "https:" &&
      Number.isInteger(timeout) &&
      timeout >= 100 &&
      timeout <= 30000
    );
  } catch {
    return false;
  }
}
export async function runLatencyTests(
  names: string[],
  test: (name: string) => Promise<void>,
  signal: AbortSignal,
  concurrency = 4,
) {
  const queue = [...new Set(names)];
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (!signal.aborted && index < queue.length) {
        const name = queue[index++];
        await test(name);
      }
    }),
  );
}
