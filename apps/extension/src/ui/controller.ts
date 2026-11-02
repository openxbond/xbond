import { useCallback, useEffect, useState } from "react";

import type {
  ControlReply,
  ExtensionCommand,
  ExtensionSnapshot,
} from "../shared/control.ts";

function reply(value: unknown): ControlReply {
  if (
    value &&
    typeof value === "object" &&
    "ok" in value &&
    typeof value.ok === "boolean"
  ) {
    if (
      value.ok &&
      "snapshot" in value &&
      value.snapshot &&
      typeof value.snapshot === "object" &&
      "state" in value.snapshot
    )
      return value as ControlReply;
    if (!value.ok && "error" in value && typeof value.error === "string")
      return value as ControlReply;
  }
  throw new Error("Invalid response from the extension background");
}
function send(command: ExtensionCommand): Promise<ControlReply> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      reject(new Error("extension_unavailable"));
      return;
    }
    const timeout = setTimeout(
      () => reject(new Error("Background response timed out")),
      30000,
    );
    chrome.runtime.sendMessage(command, (value) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      try {
        resolve(reply(value));
      } catch (error) {
        reject(error);
      }
    });
  });
}
export function useController() {
  const [model, setModel] = useState<ExtensionSnapshot | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const result = await send({ type: "get-snapshot" });
      if (result.snapshot) setModel(result.snapshot);
      if (!result.ok) setError(result.error);
    } catch (reason) {
      setError(String(reason));
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refresh);
    if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
    const listener = (message: unknown) => {
      if (
        message &&
        typeof message === "object" &&
        "type" in message &&
        message.type === "snapshot"
      ) {
        try {
          const result = reply(message);
          if (result.snapshot) setModel(result.snapshot);
        } catch (reason) {
          setError(String(reason));
        }
      }
      return undefined;
    };
    chrome.runtime.onMessage.addListener(listener);
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      clearInterval(timer);
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [refresh]);
  const act = useCallback(
    async (command: ExtensionCommand): Promise<boolean> => {
      if (pending) return false;
      setPending(true);
      setError(null);
      setFeedback(false);
      try {
        const result = await send(command);
        if (result.snapshot) setModel(result.snapshot);
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        setFeedback(true);
        return true;
      } catch (reason) {
        setError(String(reason));
        return false;
      } finally {
        setPending(false);
      }
    },
    [pending],
  );
  return { model, pending, error, feedback, act, refresh };
}
export type Controller = ReturnType<typeof useController>;

export function openManagement(page = "home", group?: string): void {
  const fragment = page + (group ? `?group=${encodeURIComponent(group)}` : "");
  chrome.tabs.create({
    url: chrome.runtime.getURL(`src/page/index.html#${fragment}`),
  });
}
export function exportLog(events: ExtensionSnapshot["events"]): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(events, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "xbond-extension-events.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
