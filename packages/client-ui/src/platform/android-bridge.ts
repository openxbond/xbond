import { isMobileApp, isTauriAndroid } from "./host.ts";
import { invokeTauri } from "./local-api-bootstrap.ts";

/**
 * Typed surface for the Tauri `xbond` mobile plugin (net.xbond.app.xbond on
 * Android, the Swift plugin on iOS). Every call degrades to a browser-safe
 * no-op so the same build runs in a plain desktop browser or the dev server.
 */

export interface InstalledApp {
  label: string;
  packageName: string;
  isSystem: boolean;
}

export type SplitTunnelMode = "all" | "disallow" | "allow";

export interface SplitTunnelConfig {
  mode: SplitTunnelMode;
  packages: string[];
}

declare global {
  interface Window {
    /** Web-side back handler (app-shell); the thin launcher activity asks
     * it before moving the task to the background. */
    __xbondHandleBack?: () => boolean;
  }
}

/** Raw invoke into the xbond plugin; null outside the Android shell. */
function pluginInvoke() {
  if (!isTauriAndroid()) return null;
  return invokeTauri();
}

/** True inside the Tauri Android shell (per-app VPN, updates, split tunnel). */
export function hasAndroidBridge(): boolean {
  return pluginInvoke() !== null;
}

async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  const invoke = pluginInvoke();
  if (!invoke) return null;
  try {
    return (await invoke(`plugin:xbond|${command}`, args)) as T;
  } catch {
    return null;
  }
}

/** Installed apps for the per-app VPN picker; [] outside Android. */
export async function listInstalledApps(): Promise<InstalledApp[]> {
  const parsed = await call<InstalledApp[]>("list_installed_apps");
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is InstalledApp =>
      typeof item === "object" &&
      item !== null &&
      typeof item.packageName === "string" &&
      typeof item.label === "string",
  );
}

/** Saved split-tunnel config; defaults to every app riding the VPN. */
export async function getSplitTunnelConfig(): Promise<SplitTunnelConfig> {
  const parsed = await call<Partial<SplitTunnelConfig>>(
    "get_split_tunnel_config",
  );
  if (!parsed || typeof parsed !== "object") {
    return { mode: "all", packages: [] };
  }
  const mode: SplitTunnelMode =
    parsed.mode === "allow" || parsed.mode === "disallow" ? parsed.mode : "all";
  const packages = Array.isArray(parsed.packages)
    ? parsed.packages.filter(
        (pkg): pkg is string => typeof pkg === "string" && pkg.length > 0,
      )
    : [];
  return { mode, packages };
}

/** Persists the config and hot-reloads the VPN interface when connected. */
export async function setSplitTunnelConfig(
  config: SplitTunnelConfig,
): Promise<boolean> {
  const saved = await call<boolean>("set_split_tunnel_config", {
    json: JSON.stringify(config),
  });
  return saved === true;
}

/** Manual update check through the native installer flow. */
export function checkForUpdates(): void {
  void call("check_for_updates", { manual: true });
}

/**
 * Syncs the Android status/gesture bars with the resolved theme. `colorHex`
 * is a #rrggbb surface color (the theme-color meta already carries one).
 */
export function syncSystemBars(isDark: boolean, colorHex?: string): void {
  if (!isMobileApp()) return;
  void invokeTauri()?.("plugin:xbond|sync_system_bars", {
    isDark,
    color: colorHex ?? null,
  }).catch(() => {});
}

/** Opens an external URL in the Android default browser (opener plugin). */
export async function openAndroidUrl(url: string): Promise<boolean> {
  const invoke = pluginInvoke();
  if (!invoke) return false;
  try {
    await invoke("plugin:opener|open_url", { url });
    return true;
  } catch {
    return false;
  }
}
