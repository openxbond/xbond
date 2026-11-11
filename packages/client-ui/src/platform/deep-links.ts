/** Native shell deep links (Android/iOS hand the URL to the webview as an
 * `xbond-deep-link` CustomEvent):
 * - `xbond://install-config?url=…`, `clash://install-config?url=…` and
 *   `sing-box://import-remote-profile?url=…` land on the import form
 *   (`item=add-profile`) prefilled with the payload URL;
 * - `xbond://navigate?to=…` (also `route`) jumps to an in-app route.
 * Mirrors the desktop shell's import handover contract. */
export function handleDeepLink(
  raw: unknown,
  navigate: (to: string) => void,
): boolean {
  if (!raw || typeof raw !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  if (scheme !== "xbond" && scheme !== "clash" && scheme !== "sing-box") {
    return false;
  }
  const action = parsed.hostname.toLowerCase();
  const isImport =
    action === "install-config" ||
    action === "import-remote-profile" ||
    parsed.pathname.includes("install-config") ||
    parsed.pathname.includes("import-remote-profile");
  if (isImport) {
    const urlParam = parsed.searchParams.get("url");
    if (urlParam) {
      navigate(`/config?item=add-profile&url=${encodeURIComponent(urlParam)}`);
      return true;
    }
    return false;
  }
  if (action === "navigate" || action === "route") {
    const to = parsed.searchParams.get("to") || parsed.pathname;
    if (to) {
      navigate(to);
      return true;
    }
  }
  return false;
}
