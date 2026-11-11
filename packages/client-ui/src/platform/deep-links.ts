import { listen } from "@tauri-apps/api/event";

import { invokeTauri } from "./local-api-bootstrap.ts";

/**
 * Splits a custom-scheme deep link into its scheme, authority "action" and
 * query params. The authority is read from the raw string instead of
 * `URL.hostname`: Chromium below ~126 (the Android System WebView still
 * shipping in some hosts) parses `xbond://callback?…` as an opaque path,
 * leaving `hostname` empty with the authority inside `pathname`, while
 * current engines expose it as the host. Matching the raw string keeps one
 * contract across engines, mirroring the desktop shell's strict
 * `strip_prefix` route match in Rust.
 */
function parseCustomScheme(raw: string): {
  scheme: string;
  action: string;
  path: string;
  params: URLSearchParams;
} | null {
  const match = /^(xbond|clash|sing-box):\/\/([^?#]*)(?:\?([^#]*))?/i.exec(raw);
  if (!match) return null;
  const authority = match[2];
  const action = authority.split("/", 1)[0].toLowerCase();
  const path = authority.slice(action.length).replace(/\/+$/, "");
  return {
    scheme: match[1].toLowerCase(),
    action,
    path,
    params: new URLSearchParams(match[3] ?? ""),
  };
}

/** The `xbond://callback` OAuth landing: code/state from the deep link's
 * query, `null` for any other route or missing params. Strict like the
 * desktop shell — extra path segments must not masquerade as the landing. */
export function accountCallbackFromDeepLink(
  raw: string,
): { code: string; state: string } | null {
  const parsed = parseCustomScheme(raw);
  if (!parsed || parsed.scheme !== "xbond") return null;
  if (parsed.action !== "callback" || parsed.path !== "") return null;
  const code = parsed.params.get("code");
  const state = parsed.params.get("state");
  if (!code || !state) return null;
  return { code, state };
}

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
  const parsed = parseCustomScheme(raw);
  if (!parsed) return false;
  const { action, path, params } = parsed;
  const isImport =
    action === "install-config" ||
    action === "import-remote-profile" ||
    /^\/(install-config|import-remote-profile)(\/|$)/.test(path);
  if (isImport) {
    const urlParam = params.get("url");
    if (urlParam) {
      navigate(`/config?item=add-profile&url=${encodeURIComponent(urlParam)}`);
      return true;
    }
    return false;
  }
  if (action === "navigate" || action === "route") {
    const to = params.get("to") || path;
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
  const callback = accountCallbackFromDeepLink(raw);
  if (!callback) return false;
  const invoke = invokeTauri();
  if (!invoke) return false;
  try {
    const delivered = (await invoke("plugin:xbond|deliver_account_callback", {
      code: callback.code,
      state: callback.state,
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
