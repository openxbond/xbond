/**
 * Tactile feedback through the native `xbond` plugin's `perform_haptic`
 * command: Android `View.performHapticFeedback` (no permission needed,
 * unlike navigator.vibrate, which Android WebView silences by default) and
 * iOS `UIImpactFeedbackGenerator` / `UINotificationFeedbackGenerator`.
 *
 * Fire-and-forget by design: haptics accompany a state change the UI
 * already shows, so the call is never awaited and failures are swallowed.
 * Desktop and browser hosts resolve to a no-op — haptics are a
 * mobile-shell affordance only (DESIGN.md 共用狀態: 觸覺回饋).
 */
import { isMobileApp } from "./host";
import { invokeTauri } from "./local-api-bootstrap";

export type HapticKind = "tap" | "confirm" | "error";

/** One short system haptic for a key state change; no-op outside mobile. */
export function performHaptic(kind: HapticKind): void {
  if (!isMobileApp()) return;
  void invokeTauri()?.("plugin:xbond|perform_haptic", { kind }).catch(() => {});
}
