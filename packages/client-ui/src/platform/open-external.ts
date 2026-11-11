import { openAndroidUrl } from "./android-bridge.ts";
import { isIOSNativeApp, isMobileApp } from "./host.ts";
import { invokeDesktop, isDesktopApp } from "./local-api-bootstrap.ts";

/**
 * Opens a URL in the user's default browser. The desktop and mobile webviews
 * have no native target="_blank" handling, so they hand off to shell or native
 * intent handlers; plain browser hosts keep window.open.
 */
export async function openExternalUrl(url: string): Promise<void> {
  const invoke = isDesktopApp() ? invokeDesktop() : null;
  if (invoke) {
    await invoke("open_external_url", { url });
    return;
  }
  if (isIOSNativeApp()) {
    if (
      typeof window !== "undefined" &&
      typeof window.XBondIOS === "object" &&
      window.XBondIOS?.openURL
    ) {
      window.XBondIOS.openURL(url);
      return;
    }
    // The iOS shell intercepts external main-frame navigations and opens
    // them in Safari; window.open lands nowhere (WKWebView has no native
    // window to create without a UIDelegate).
    window.location.href = url;
    return;
  }
  if (isMobileApp() && openAndroidUrl(url)) {
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
