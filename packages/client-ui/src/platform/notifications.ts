import { isMobileApp } from "./host.ts";
import { invokeDesktop, invokeTauri } from "./local-api-bootstrap.ts";

export type NotificationPermissionState = "granted" | "denied" | "prompt";

const NOTIF_PROMPTED_PREF_KEY = "notif_prompted_on_connect";
const promptedInvokers = new WeakSet<object>();
let inFlightFirstConnectPrompt: Promise<void> | null = null;

function pluginInvoke() {
  if (!isMobileApp()) return null;
  return invokeTauri();
}

export async function getMobileNotificationPermissionState(): Promise<NotificationPermissionState | null> {
  const invoke = pluginInvoke();
  if (!invoke) return null;
  try {
    const state = await invoke(
      "plugin:xbond|get_notification_permission_state",
    );
    if (state === "granted" || state === "denied" || state === "prompt") {
      return state;
    }
    return null;
  } catch {
    return null;
  }
}

export async function requestMobileNotificationPermission(): Promise<boolean> {
  const invoke = pluginInvoke();
  if (!invoke) return false;
  try {
    return (
      (await invoke("plugin:xbond|request_notification_permission")) === true
    );
  } catch {
    return false;
  }
}

export async function openMobileNotificationSettings(): Promise<boolean> {
  const invoke = pluginInvoke();
  if (!invoke) return false;
  try {
    return (await invoke("plugin:xbond|open_notification_settings")) === true;
  } catch {
    return false;
  }
}

/**
 * Prompts once on the user's first VPN connect attempt on mobile when the OS
 * permission state is still "prompt". Never blocks the VPN connection if
 * declined or unavailable, and never auto-prompts again afterwards.
 */
export async function promptMobileNotificationOnFirstConnect(): Promise<void> {
  const invoke = pluginInvoke();
  if (!invoke || promptedInvokers.has(invoke)) return;
  if (inFlightFirstConnectPrompt) {
    await inFlightFirstConnectPrompt;
    return;
  }
  const task = (async () => {
    try {
      const prompted = await invoke("plugin:xbond|get_preference", {
        key: NOTIF_PROMPTED_PREF_KEY,
      }).catch(() => null);
      if (prompted === "1") {
        promptedInvokers.add(invoke);
        return;
      }

      const state = await getMobileNotificationPermissionState();
      if (state !== "prompt") {
        if (state === "granted" || state === "denied") {
          promptedInvokers.add(invoke);
          await invoke("plugin:xbond|set_preference", {
            key: NOTIF_PROMPTED_PREF_KEY,
            value: "1",
          }).catch(() => {});
        }
        return;
      }

      promptedInvokers.add(invoke);
      await invoke("plugin:xbond|set_preference", {
        key: NOTIF_PROMPTED_PREF_KEY,
        value: "1",
      }).catch(() => {});
      await requestMobileNotificationPermission();
    } catch {
      // Notification permission must never fail or block VPN connect.
    } finally {
      inFlightFirstConnectPrompt = null;
    }
  })();
  inFlightFirstConnectPrompt = task;
  await task;
}

export async function canOpenDesktopNotificationSettings(): Promise<boolean> {
  const invoke = invokeDesktop();
  if (!invoke) return false;
  try {
    return (await invoke("can_open_notification_settings")) === true;
  } catch {
    return false;
  }
}

export async function openDesktopNotificationSettings(): Promise<void> {
  const invoke = invokeDesktop();
  if (!invoke) return;
  await invoke("open_notification_settings");
}
