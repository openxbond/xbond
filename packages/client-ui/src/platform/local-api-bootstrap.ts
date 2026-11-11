import type { LocalAPIConfig } from "@xbond/client/localapi";

import { isMobileApp, isTauriRuntime } from "./host.ts";

/**
 * Adds the http scheme to a bare host:port endpoint. Meta-tag and query-param
 * discovery accept bare addresses (e.g. ?localapi_addr=127.0.0.1:33803), but a
 * scheme-less endpoint makes fetch resolve it as a relative URL against the
 * current origin. Same-origin daemon pages pass an empty addr and stay relative.
 */
function normalizeEndpoint(addr: string | null | undefined): string {
  const trimmed = addr?.replace(/\/$/, "") ?? "";
  return trimmed && !/^https?:\/\//.test(trimmed)
    ? `http://${trimmed}`
    : trimmed;
}

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
    return { endpoint: normalizeEndpoint(metaAddr), token: metaToken };
  }

  // 2. URL search params: ?localapi_token=...&localapi_addr=...
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const paramToken = searchParams.get("localapi_token");
    const paramAddr = searchParams.get("localapi_addr");
    if (paramToken) {
      return {
        endpoint: normalizeEndpoint(paramAddr),
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
        endpoint: normalizeEndpoint(savedAddr),
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
  return isTauriRuntime() && !isMobileApp();
}

/**
 * Whether this window has a daemon to manage: injected localapi meta
 * (daemon-served page, mobile WebView), a saved controller identity, or the
 * Tauri shell. Subscriptions are daemon-owned, so the pure web deployment —
 * a browser page pointing at a bare remote controller — has nothing to
 * manage them on; subscription navigation and import surfaces hide there
 * (Sidebar, App, Connect).
 */
export function hasDaemonConfig(): boolean {
  return Boolean(detectLocalAPIConfig() || isTauriRuntime());
}

type TauriInternals = {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
};

/** Raw Tauri IPC for desktop commands and native plugins. */
export function invokeTauri(): TauriInternals["invoke"] | null {
  if (typeof window === "undefined") return null;
  const internals = (
    window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
  ).__TAURI_INTERNALS__;
  return internals?.invoke ?? null;
}

export function invokeDesktop(): TauriInternals["invoke"] | null {
  return isDesktopApp() ? invokeTauri() : null;
}

/**
 * Resolves LocalAPI configuration from the Tauri shell: the desktop app
 * command (`get_localapi_config`, daemon-supervised) or, on mobile, the xbond
 * plugin (`plugin:xbond|get_localapi_config`, the in-process VPN service that
 * owns the TunnelService). Mobile answers may be not-ready while the service
 * boots; the connection core retries.
 */
export async function resolveShellLocalAPIConfig(): Promise<LocalAPIConfig | null> {
  if (!isTauriRuntime()) return null;
  try {
    const invoke = invokeTauri();
    if (invoke) {
      const cfg = (await invoke(
        isMobileApp()
          ? "plugin:xbond|get_localapi_config"
          : "get_localapi_config",
      )) as { addr: string; token: string; is_running?: boolean } | null;
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
