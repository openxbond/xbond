import { isMobileApp } from "./host.ts";
import { invokeTauri } from "./local-api-bootstrap.ts";

/**
 * Opens a URL in the user's default browser. The desktop and mobile webviews
 * have no native target="_blank" handling: the desktop shell owns an allow-
 * listed URL command, the mobile shells route through the opener plugin,
 * and plain browser hosts keep window.open.
 */
export async function openExternalUrl(url: string): Promise<void> {
  const invoke = invokeTauri();
  if (invoke) {
    if (isMobileApp()) {
      await invoke("plugin:opener|open_url", { url });
      return;
    }
    await invoke("open_external_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
