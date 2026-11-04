// Self-hosted Inter — no third-party font CDN; bundled and cached by Vite.
import "@fontsource-variable/inter";
import { isClashX, setupJsBridge } from "@/platform/clashx-bridge";

import renderApp from "./mount-app";

/**
 * Global entry
 * Will check if need setup jsbridge
 */
if (isClashX()) {
  setupJsBridge(() => renderApp());
} else {
  renderApp();
}
