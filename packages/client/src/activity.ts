import { formatTraffic } from "./helper.ts";

export interface ConnectionItem {
  id: string;
  metadata: {
    host: string;
    destinationIP: string;
    destinationPort: string;
    sourceIP: string;
    network: string;
    type: string;
    processPath?: string;
  };
  rule: string;
  rulePayload?: string;
  chains: string[];
  upload: number;
  download: number;
}

export interface LogItem {
  time?: string | Date;
  type: string; // "info" | "warning" | "error" | "debug"
  payload: string;
}

/**
 * Formats transfer rate per second with explicit units.
 */
export function formatRate(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
    return "0 B/s";
  }
  return `${formatTraffic(bytesPerSec)}/s`;
}

/**
 * Filters connection list by host/IP, process path, and rule keywords.
 */
export function filterConnections(
  connections: ConnectionItem[],
  filter: { host?: string; process?: string; rule?: string; keyword?: string },
): ConnectionItem[] {
  const host = filter.host?.trim().toLowerCase();
  const process = filter.process?.trim().toLowerCase();
  const rule = filter.rule?.trim().toLowerCase();
  const kw = filter.keyword?.trim().toLowerCase();

  return connections.filter((conn) => {
    if (host) {
      const target =
        `${conn.metadata.host} ${conn.metadata.destinationIP}`.toLowerCase();
      if (!target.includes(host)) return false;
    }
    if (process) {
      const proc = (conn.metadata.processPath ?? "").toLowerCase();
      if (!proc.includes(process)) return false;
    }
    if (rule) {
      const r = `${conn.rule} ${conn.rulePayload ?? ""}`.toLowerCase();
      if (!r.includes(rule)) return false;
    }
    if (kw) {
      const combined =
        `${conn.metadata.host} ${conn.metadata.destinationIP} ${conn.metadata.processPath ?? ""} ${conn.rule} ${conn.chains.join(" ")}`.toLowerCase();
      if (!combined.includes(kw)) return false;
    }
    return true;
  });
}

/**
 * Filters log entries by level and keyword.
 */
export function filterLogs(
  logs: LogItem[],
  keyword?: string,
  level?: string,
): LogItem[] {
  const kw = keyword?.trim().toLowerCase();
  const lvl = level?.trim().toLowerCase();

  return logs.filter((log) => {
    if (lvl && lvl !== "all" && lvl !== "") {
      if (log.type.toLowerCase() !== lvl) return false;
    }
    if (kw) {
      if (!log.payload.toLowerCase().includes(kw)) return false;
    }
    return true;
  });
}
