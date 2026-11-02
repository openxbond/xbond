import { REQUEST_RECORD_LIMIT, type RequestRecord } from "../shared/control.ts";
import {
  loadRecording,
  loadRequests,
  redact,
  saveRequests,
  saveRecording,
  logEvent,
} from "./store.ts";

export interface BrowserRequestEvent {
  requestId: string | number;
  url: string;
  type?: string;
  timeStamp?: number;
  initiator?: string;
  error?: string;
}
export function reduceRequests(
  records: RequestRecord[],
  kind: "start" | "completed" | "failed",
  details: BrowserRequestEvent,
): RequestRecord[] {
  const id = String(details.requestId);
  if (kind === "start") {
    if (details.initiator?.startsWith("chrome-extension:")) return records;
    let url: URL;
    try {
      url = new URL(details.url);
    } catch {
      return records;
    }
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol))
      return records;
    const record: RequestRecord = {
      id,
      at: details.timeStamp ?? Date.now(),
      host: url.hostname,
      type: details.type ?? "other",
      status: "pending",
    };
    return [...records.filter((item) => item.id !== id), record].slice(
      -REQUEST_RECORD_LIMIT,
    );
  }
  return records.map((record) =>
    record.id === id
      ? {
          ...record,
          status: kind,
          duration: Math.max(0, (details.timeStamp ?? Date.now()) - record.at),
          ...(details.error ? { error: redact(details.error) } : {}),
        }
      : record,
  );
}
let queue: Promise<void> = Promise.resolve();
export function captureRequest(
  kind: "start" | "completed" | "failed",
  details: BrowserRequestEvent,
  changed: () => void,
): void {
  queue = queue
    .then(async () => {
      if (!(await loadRecording())) return;
      const records = await loadRequests();
      await saveRequests(reduceRequests(records, kind, details));
      changed();
    })
    .catch(async () => {
      logEvent("error", "request recording stopped after a storage failure");
      await saveRecording(false);
      changed();
    });
}
export async function flushRequests(): Promise<void> {
  await queue;
}
