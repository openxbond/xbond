import { isMobileApp } from "./host.ts";

/**
 * Typed surface for `window.XBondAndroid`, the @JavascriptInterface bridge
 * MainActivity installs. Every call degrades to a browser-safe no-op so the
 * same build runs in a plain desktop browser or the dev server.
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

interface XBondAndroidBridge {
  getInstalledApps(): string;
  getSplitTunnelConfig(): string;
  setSplitTunnelConfig(json: string): boolean;
  checkForUpdates(): void;
  syncSystemBars(isDark: boolean, colorHex?: string): void;
  openURL?(url: string): boolean;
  getPreference?(key: string): string | null;
  setPreference?(key: string, value: string): boolean;
}

declare global {
  interface Window {
    XBondAndroid?: XBondAndroidBridge;
    __xbondHandleBack?: () => boolean;
  }
}

function bridge(): XBondAndroidBridge | null {
  if (!isMobileApp()) return null;
  return window.XBondAndroid ?? null;
}

export function hasAndroidBridge(): boolean {
  return bridge() !== null;
}

/** Installed apps for the per-app VPN picker; [] outside Android. */
export function listInstalledApps(): InstalledApp[] {
  const native = bridge();
  if (!native) return [];
  try {
    const parsed: unknown = JSON.parse(native.getInstalledApps());
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is InstalledApp =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as InstalledApp).packageName === "string" &&
        typeof (item as InstalledApp).label === "string",
    );
  } catch {
    return [];
  }
}

/** Saved split-tunnel config; defaults to every app riding the VPN. */
export function getSplitTunnelConfig(): SplitTunnelConfig {
  const native = bridge();
  if (!native) return { mode: "all", packages: [] };
  try {
    const parsed = JSON.parse(
      native.getSplitTunnelConfig(),
    ) as Partial<SplitTunnelConfig>;
    const mode: SplitTunnelMode =
      parsed.mode === "allow" || parsed.mode === "disallow"
        ? parsed.mode
        : "all";
    const packages = Array.isArray(parsed.packages)
      ? parsed.packages.filter(
          (pkg): pkg is string => typeof pkg === "string" && pkg.length > 0,
        )
      : [];
    return { mode, packages };
  } catch {
    return { mode: "all", packages: [] };
  }
}

/** Persists the config and hot-reloads the VPN interface when connected. */
export function setSplitTunnelConfig(config: SplitTunnelConfig): boolean {
  const native = bridge();
  if (!native) return false;
  return native.setSplitTunnelConfig(JSON.stringify(config));
}

/** Manual update check through the native installer flow. */
export function checkForUpdates(): void {
  bridge()?.checkForUpdates();
}

/**
 * Syncs the Android status/gesture bars with the resolved theme. `colorHex`
 * is a #rrggbb surface color (the theme-color meta already carries one).
 */
export function syncSystemBars(isDark: boolean, colorHex?: string): void {
  bridge()?.syncSystemBars(isDark, colorHex);
  if (
    typeof window !== "undefined" &&
    typeof window.XBondIOS === "object" &&
    window.XBondIOS?.syncSystemBars
  ) {
    window.XBondIOS.syncSystemBars(isDark, colorHex);
  }
}

/** Opens an external URL in the Android default browser. */
export function openAndroidUrl(url: string): boolean {
  const native = bridge();
  if (!native?.openURL) return false;
  return native.openURL(url);
}

/** Reads a persistent preference from the native Android host. */
export function getAndroidPreference(key: string): string | null {
  const native = bridge();
  if (!native?.getPreference) return null;
  try {
    return native.getPreference(key);
  } catch {
    return null;
  }
}

/** Writes a persistent preference to the native Android host. */
export function setAndroidPreference(key: string, value: string): boolean {
  const native = bridge();
  if (!native?.setPreference) return false;
  try {
    return native.setPreference(key, value);
  } catch {
    return false;
  }
}
