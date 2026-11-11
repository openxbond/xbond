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
