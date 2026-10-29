import type { LocalAPIConfig } from "@xbond/client/localapi";

/**
 * Detects LocalAPI connection info from HTML meta tags, query params, or localStorage.
 */
export function detectLocalAPIConfig(): LocalAPIConfig | null {
  if (typeof document === "undefined") return null;

  // 1. Injected by xbond daemon / web
  const metaToken = document
    .querySelector('meta[name="localapi-token"]')
    ?.getAttribute("content");
  const metaAddr = document
    .querySelector('meta[name="localapi-addr"]')
    ?.getAttribute("content");

  if (metaToken) {
    const endpoint = metaAddr ? metaAddr.replace(/\/$/, "") : "";
    return { endpoint, token: metaToken };
  }

  // 2. URL search params: ?localapi_token=...&localapi_addr=...
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const paramToken = searchParams.get("localapi_token");
    const paramAddr = searchParams.get("localapi_addr");
    if (paramToken) {
      return {
        endpoint: paramAddr ? paramAddr.replace(/\/$/, "") : "",
        token: paramToken,
      };
    }
  } catch {
    // Ignore URL parse errors
  }

  // 3. Saved in localStorage
  try {
    const savedToken = localStorage.getItem("xbond_localapi_token");
    const savedAddr = localStorage.getItem("xbond_localapi_addr");
    if (savedToken) {
      return {
        endpoint: savedAddr ? savedAddr.replace(/\/$/, "") : "",
        token: savedToken,
      };
    }
  } catch {
    // Ignore storage errors
  }

  return null;
}

/**
 * Checks whether the current frontend is running inside Tauri desktop shell.
 */
export function isDesktopApp(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "__TAURI_INTERNALS__" in window ||
    "__TAURI__" in window ||
    Boolean(
      (window as unknown as { __TAURI_METADATA__?: unknown })
        .__TAURI_METADATA__,
    )
  );
}

/**
 * Resolves LocalAPI configuration from Tauri desktop IPC if running in desktop mode.
 */
export async function resolveDesktopLocalAPIConfig(): Promise<LocalAPIConfig | null> {
  if (!isDesktopApp()) return null;
  try {
    const tauri = window as unknown as {
      __TAURI_INTERNALS__?: {
        invoke: (
          cmd: string,
        ) => Promise<{ addr: string; token: string; is_running: boolean }>;
      };
    };
    const invoke = tauri.__TAURI_INTERNALS__?.invoke;
    if (invoke) {
      const cfg = await invoke("get_localapi_config");
      if (cfg && cfg.token) {
        const endpoint = cfg.addr.startsWith("http")
          ? cfg.addr
          : `http://${cfg.addr}`;
        return { endpoint, token: cfg.token };
      }
    }
  } catch {
    // Ignore IPC resolution failure
  }
  return null;
}
