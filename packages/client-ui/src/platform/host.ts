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

declare global {
  interface Window {
    /** Set by the iOS shell's document-start user script (DashboardViewController). */
    XBondIOS?:
      | {
          openURL?(url: string): boolean;
          syncSystemBars?(isDark: boolean, colorHex?: string): void;
        }
      | boolean;
  }
}

/** True inside the iOS native shell, via its document-start XBondIOS marker. */
export function isIOSNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  return "XBondIOS" in window;
}

/**
 * True when the UI runs inside a mobile native host (Android WebView with
 * the XBond bridge, or an iOS host): desktop-only concepts (system proxy,
 * TUN privileges, service install) never render there.
 */
export function isMobileApp(): boolean {
  if (typeof window === "undefined") return false;
  if ("XBondAndroid" in window) return true;
  // The iOS host injects this marker with a document-start user script. The
  // user agent alone cannot separate it from iPhone/iPad Safari, which must
  // stay a plain web host.
  if ("XBondIOS" in window) return true;
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /; wv\).*(?:Chrome|Mobile)/i.test(ua);
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
