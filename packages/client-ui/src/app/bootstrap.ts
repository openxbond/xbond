import { isClashX, setupJsBridge } from "@/platform/clashx-bridge";
import { initDesktopShellDom } from "@/platform/desktop-shell";
import { initUiHost } from "@/platform/host";

import renderApp from "./mount-app";

export { isTauriRuntime } from "@/platform/host";

initUiHost();

/**
 * Global entry
 * Will check if need setup jsbridge
 */
if (isClashX()) {
  setupJsBridge(() => renderApp());
} else {
  initDesktopShellDom();
  renderApp();
}
