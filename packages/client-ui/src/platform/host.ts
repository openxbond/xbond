export type UiHost = "macos" | "windows" | "ios" | "android" | "web";

/**
 * Picks the visual host from the user agent so tokens.css can select fonts
 * per platform. Linux and unknown browsers
 * fall back to the neutral web scale; iPadOS reports as Macintosh with touch.
 */
export function detectUiHost(): UiHost {
  if (typeof navigator === "undefined") return "web";
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
