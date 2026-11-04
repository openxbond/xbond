import { invokeDesktop, isDesktopApp } from "./local-api-bootstrap.ts";

/**
 * Opens a URL in the user's default browser. The desktop webview has no
 * target="_blank" handling, so there the shell's open_external_url command
 * does the opening; browser hosts keep the plain window.open path.
 */
export async function openExternalUrl(url: string): Promise<void> {
  const invoke = isDesktopApp() ? invokeDesktop() : null;
  if (invoke) {
    await invoke("open_external_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
