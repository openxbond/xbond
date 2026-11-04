export interface DesktopShortcutEvent {
  metaKey?: boolean;
  ctrlKey?: boolean;
  key: string;
  isInput?: boolean;
  isDev?: boolean;
}

/**
 * Native desktop keyboard shortcut handler:
 * - Cmd/Ctrl + , : Settings
 * - Cmd/Ctrl + W : Close/minimize window
 * - Cmd/Ctrl + 1..8 : Tab switching
 * - F5 / Cmd/Ctrl + R: Prevent accidental reload in production
 */
export function handleDesktopShortcut(
  event: DesktopShortcutEvent,
  navigate: (path: string) => void,
  closeWindow?: () => void,
): boolean {
  const isMod = Boolean(event.metaKey || event.ctrlKey);
  const key = event.key.toLowerCase();

  if (!isMod) {
    if (!event.isDev && event.key === "F5") {
      return true;
    }
    return false;
  }

  if (key === ",") {
    navigate("/settings");
    return true;
  }

  if (key === "w") {
    closeWindow?.();
    return true;
  }

  if (!event.isDev && key === "r") {
    return true;
  }

  if (event.isInput) {
    return false;
  }

  const routes = [
    "/connect",
    "/proxies",
    "/config",
    "/connections",
    "/rules",
    "/logs",
    "/diagnostics",
    "/settings",
  ];
  const index = parseInt(key, 10);
  if (!isNaN(index) && index >= 1 && index <= routes.length) {
    navigate(routes[index - 1]);
    return true;
  }

  return false;
}
