import { formatTraffic } from "@xbond/client/helper";

export type DownloadProgress = {
  percent: number | null;
  label: string | null;
};

/** Formats desktop updater byte counters into determinate percentage + readable sizes. */
export function formatDownloadProgress(
  received?: number,
  total?: number | null,
): DownloadProgress {
  const bytesReceived = Math.max(0, received ?? 0);
  if (total != null && total > 0) {
    const clamped = Math.min(bytesReceived, total);
    const percent = Math.min(100, Math.round((clamped / total) * 100));
    return {
      percent,
      label: `${formatTraffic(clamped)} / ${formatTraffic(total)} (${percent}%)`,
    };
  }
  if (bytesReceived > 0) {
    return {
      percent: null,
      label: formatTraffic(bytesReceived),
    };
  }
  return { percent: null, label: null };
}

/** Maps a UI locale tag to the matching single-locale release note section. */
export function selectLocalizedReleaseNote(
  notesByLocale: Record<string, string> | undefined,
  language: string,
): string | null {
  if (!notesByLocale) return null;
  const lower = language.trim().toLowerCase();
  let preferred = "en-us";
  if (/^(zh-tw|zh-hk|zh-mo|zh-hant)/.test(lower)) preferred = "zh-hk";
  else if (lower.startsWith("zh")) preferred = "zh-cn";
  else if (lower.startsWith("ko")) preferred = "ko";
  else if (lower.startsWith("fa")) preferred = "fa";
  else if (lower.startsWith("ru")) preferred = "ru";

  const candidate =
    notesByLocale[preferred]?.trim() || notesByLocale["en-us"]?.trim();
  return candidate || null;
}
