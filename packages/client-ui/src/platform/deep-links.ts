import { listen } from "@tauri-apps/api/event";

import { invokeTauri } from "./local-api-bootstrap.ts";

/**
 * Native shell deep links:
 * - `xbond://install-config?url=…`, `clash://install-config?url=…` and
 *   `sing-box://import-remote-profile?url=…` land on the import form
 *   (`item=add-profile`) prefilled with the payload URL;
 * - `xbond://navigate?to=…` (also `route`) jumps to an in-app route;
 * - `xbond://callback?code&state` delivers the OAuth code to the in-process
 *   LocalAPI and dispatches `xbond-account-updated`.
 * Mirrors the desktop shell's import handover contract.
 */
export function handleDeepLink(
  raw: unknown,
  navigate: (to: string) => void,
): boolean {
  if (!raw || typeof raw !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  if (scheme !== "xbond" && scheme !== "clash" && scheme !== "sing-box") {
    return false;
  }
  const action = parsed.hostname.toLowerCase();
  const isImport =
    action === "install-config" ||
    action === "import-remote-profile" ||
    parsed.pathname.includes("install-config") ||
    parsed.pathname.includes("import-remote-profile");
  if (isImport) {
    const urlParam = parsed.searchParams.get("url");
    if (urlParam) {
      navigate(`/config?item=add-profile&url=${encodeURIComponent(urlParam)}`);
      return true;
    }
    return false;
  }
  if (action === "navigate" || action === "route") {
    const to = parsed.searchParams.get("to") || parsed.pathname;
    if (to) {
      navigate(to);
      return true;
    }
  }
  return false;
}

/** Account-callback delivery (mobile shell): the shell used to POST the
 * code/state itself; now the frontend routes it through the xbond plugin,
 * which answers true once the LocalAPI accepted the delivery. */
async function deliverAccountCallback(raw: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol.replace(":", "").toLowerCase() !== "xbond") return false;
  if (parsed.hostname.toLowerCase() !== "callback") return false;
  const code = parsed.searchParams.get("code");
  const state = parsed.searchParams.get("state");
  if (!code || !state) return false;
  const invoke = invokeTauri();
  if (!invoke) return false;
  try {
    const delivered = (await invoke("plugin:xbond|deliver_account_callback", {
      code,
      state,
    })) as boolean;
    if (delivered) {
      window.dispatchEvent(new CustomEvent("xbond-account-updated"));
    }
    return delivered;
  } catch {
    return false;
  }
}

/** Listen for incoming URLs and recover a launch URL sent before registration. */
export function installTauriDeepLinkListener(
  navigate: (to: string) => void,
): () => void {
  let unlisten: (() => void) | null = null;
  let disposed = false;
  let launchUrls: Set<string> | null = new Set();
  const route = (raw: string) => {
    void deliverAccountCallback(raw);
    handleDeepLink(raw, navigate);
  };
  void listen<string[]>("deep-link://new-url", (event) => {
    for (const raw of event.payload ?? []) {
      launchUrls?.add(raw);
      route(raw);
    }
  })
    .then(async (fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
      const urls = await invokeTauri()?.("plugin:deep-link|get_current");
      if (disposed || !Array.isArray(urls)) return;
      for (const url of urls) {
        if (typeof url === "string" && !launchUrls?.has(url)) route(url);
      }
    })
    .catch(() => {})
    .finally(() => {
      launchUrls = null;
    });
  return () => {
    disposed = true;
    unlisten?.();
  };
}
