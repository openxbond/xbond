import { useEffect, useState } from "react";

export type UiHost = "macos" | "windows" | "ios" | "android" | "web";

/**
 * Picks the visual host from the user agent so tokens.css can select fonts
 * per platform. Linux and unknown browsers
 * fall back to the neutral web scale; iPadOS reports as Macintosh with touch.
 */
export function detectUiHost(): UiHost {
  if (typeof navigator === "undefined") return "web";
  if (isIOSNativeApp()) return "ios";
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Macintosh/i.test(ua)) {
    return navigator.maxTouchPoints > 1 ? "ios" : "macos";
  }
  if (/Windows/i.test(ua)) return "windows";
  return "web";
}

export function initUiHost(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.host = detectUiHost();
}

/** True inside any Tauri shell (desktop or mobile), via the injected IPC marker. */
export function isTauriRuntime(): boolean {
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

/** True inside the Tauri Android shell (the system webview UA reports Android). */
export function isTauriAndroid(): boolean {
  if (!isTauriRuntime()) return false;
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /Android/i.test(ua);
}

/** True inside the Tauri iOS shell (WKWebView UA reports the device family). */
export function isTauriIOS(): boolean {
  if (!isTauriRuntime()) return false;
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return (
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  );
}

/** True inside the iOS native shell. */
export function isIOSNativeApp(): boolean {
  return isTauriIOS();
}

/**
 * True when the UI runs inside a mobile native host: desktop-only concepts
 * (system proxy, TUN privileges, service install) never render there.
 */
export function isMobileApp(): boolean {
  return isTauriAndroid() || isTauriIOS();
}

const mobileViewportQuery = "(max-width: 767px)";

/** Reactive mobile context: the native mobile host or a sub-768px viewport. */
export function useIsMobile(): boolean {
  const [inApp] = useState(isMobileApp);
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(mobileViewportQuery).matches;
  });

  useEffect(() => {
    const query = window.matchMedia(mobileViewportQuery);
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return inApp || narrow;
}
