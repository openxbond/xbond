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

/** LocalAPI 的 engine.uptime 是 Go duration 字串（如 "1h24m38.5s"）。
 * 转成首页计时器的 HH:MM:SS（小时可超过两位）；解析不出或为 0 时返回 null。 */
export function formatUptimeClock(uptime: string | undefined): string | null {
  if (!uptime) return null;
  const hours = /(\d+(?:\.\d+)?)h/.exec(uptime)?.[1];
  const minutes = /(\d+(?:\.\d+)?)m(?!s)/.exec(uptime)?.[1];
  const seconds = /(\d+(?:\.\d+)?)s/.exec(uptime)?.[1];
  if (hours === undefined && minutes === undefined && seconds === undefined)
    return null;
  const total =
    Number.parseFloat(hours ?? "0") * 3600 +
    Number.parseFloat(minutes ?? "0") * 60 +
    Number.parseFloat(seconds ?? "0");
  if (!Number.isFinite(total) || total < 1) return null;
  const whole = Math.floor(total);
  const hh = Math.floor(whole / 3600);
  const mm = Math.floor((whole % 3600) / 60);
  const ss = whole % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}
