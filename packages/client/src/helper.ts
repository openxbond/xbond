export function noop() {}

export function partition<T>(arr: T[], fn: (arg: T) => boolean): [T[], T[]] {
  const left: T[] = [];
  const right: T[] = [];
  for (const item of arr) {
    (fn(item) ? left : right).push(item);
  }
  return [left, right];
}

export function formatTraffic(num: number) {
  const s = ["B", "KiB", "MiB", "GiB", "TiB"];
  const exp = Math.floor(Math.log(num || 1) / Math.log(1024));
  return `${(Math.floor((num / Math.pow(1024, exp)) * 100) / 100).toFixed(2)} ${s?.[exp] ?? ""}`;
}

export function basePath(path: string) {
  return path.replace(/.*[/\\]/, "");
}

/** LocalAPI 的 engine.uptimeSeconds 是整數秒（internal/engine 的
 * EngineStatus.UptimeSeconds）。轉成首頁計時器的 HH:MM:SS（小時可超過兩位）；
 * 缺值或不足 1 秒時返回 null。 */
export function formatUptimeClock(
  uptimeSeconds: number | undefined,
): string | null {
  if (
    !Number.isFinite(uptimeSeconds) ||
    uptimeSeconds === undefined ||
    uptimeSeconds < 1
  ) {
    return null;
  }
  const whole = Math.floor(uptimeSeconds);
  const hh = Math.floor(whole / 3600);
  const mm = Math.floor((whole % 3600) / 60);
  const ss = whole % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}
