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
