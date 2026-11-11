export type ConnectErrorKind =
  | "port_conflict"
  | "tun_denied"
  | "vpn_consent"
  | "generic";

export interface ConnectError {
  kind: ConnectErrorKind;
  message: string;
}

/**
 * Classifies a failed LocalAPI `/up` (the daemon surfaces the raw platform
 * message as the 409 `error` body) into the dialog treatment it can act on.
 * Patterns are tied to what each producer actually emits:
 * - Android VpnService consent: the system dialog is already up over the
 *   app; once approved a retry goes straight through.
 * - Bind failures mean the core listen port is taken.
 * - Only the daemon's capability gate means "elevate and install";
 *   delegate runtime failures (config, device) carry "tun" in the message
 *   too but elevation cannot fix them.
 */
export function classifyConnectError(message: string): ConnectError {
  if (/vpn consent/i.test(message)) {
    return { kind: "vpn_consent", message };
  }
  if (/already in use|failed to bind|bind: |socket address/i.test(message)) {
    return { kind: "port_conflict", message };
  }
  if (/TUN takeover unavailable|privilege|admin|permission/i.test(message)) {
    return { kind: "tun_denied", message };
  }
  return { kind: "generic", message };
}
