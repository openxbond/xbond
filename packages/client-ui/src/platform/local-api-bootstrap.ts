import type { LocalAPIConfig } from "@xbond/client/localapi";

import { hasAndroidBridge } from "./android-bridge.ts";

// 移動宿主（Android WebView）剝離 external-controller meta：WebView 的頁面
// 緩存會把上一進程注入的 meta 帶進新會話，而 meta 在控制目標解析中優先於
// status 廣播——過期的端口／secret 讓代理頁掛上「Authentication failed」。
// status 側 preferences.clashPort/clashSecret 是進程內固定的端點，永遠新鮮；
// 剝離後移動端一律走活端點（reload 不換端口，鏈路穩定性不變）。
// localapi-token meta 是 daemon 身份憑據，保留。
if (typeof document !== "undefined" && hasAndroidBridge()) {
  document.querySelector('meta[name="external-controller"]')?.remove();
}

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
 * Whether this window has a daemon to manage: injected localapi meta
 * (daemon-served page, mobile WebView), a saved controller identity, or the
 * Tauri shell. Subscriptions are daemon-owned, so the pure web deployment —
 * a browser page pointing at a bare remote controller — has nothing to
 * manage them on; subscription navigation and import surfaces hide there
 * (Sidebar, App, Connect).
 */
export function hasDaemonConfig(): boolean {
  return Boolean(detectLocalAPIConfig() || isDesktopApp());
}

type TauriInternals = {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Raw Tauri IPC for the shell's custom commands; null outside the desktop
 * shell or when the bridge is unavailable. The desktop-facing platform code
 * (this module, desktop-shell.ts and open-external.ts) is the only consumer.
 */
export function invokeDesktop(): TauriInternals["invoke"] | null {
  if (typeof window === "undefined") return null;
  const internals = (
    window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
  ).__TAURI_INTERNALS__;
  return internals?.invoke ?? null;
}

/**
 * Resolves LocalAPI configuration from Tauri desktop IPC if running in desktop mode.
 */
export async function resolveDesktopLocalAPIConfig(): Promise<LocalAPIConfig | null> {
  if (!isDesktopApp()) return null;
  try {
    const invoke = invokeDesktop();
    if (invoke) {
      const cfg = (await invoke("get_localapi_config")) as {
        addr: string;
        token: string;
        is_running: boolean;
      } | null;
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
