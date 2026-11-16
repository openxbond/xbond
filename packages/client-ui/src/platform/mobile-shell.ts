/**
 * Mobile-shell DOM initialization, the mobile counterpart of the desktop
 * shell's `initDesktopShellDom` (platform/desktop-shell.ts): the Android
 * WebView and iOS WKWebView hosts get the `.mobile-shell` class that
 * styles/app.css keys on to drop browser residue from an app surface —
 * long-press text-selection handles on labels and readouts, and the iOS
 * long-press callout. The system tap highlight is off globally (html rule
 * in styles/app.css), independent of this class.
 *
 * Long-press selectability keeps the desktop-shell whitelist: inputs,
 * editable hosts and technical strings stay selectable per DESIGN.md
 * (網址與技術字串保留完整查看或複製方式); everything else copies through
 * explicit copy actions, not selection.
 *
 * Whole-page pinch/double-tap zoom is handled by the viewport meta
 * (apps/dashboard/index.html, `user-scalable=no`); host font scaling
 * (system fontScale → WebView textZoom) is unaffected. Runs once before
 * render; inert in browsers and the desktop shell.
 */
import { isMobileApp } from "./host";

/** Adds `.mobile-shell` to <html> before render. */
export function initMobileShellDom(): void {
  if (!isMobileApp() || typeof document === "undefined") return;
  document.documentElement.classList.add("mobile-shell");
}
