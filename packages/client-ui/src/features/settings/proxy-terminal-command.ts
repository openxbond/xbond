/**
 * The proxy inbound address follows the target: loopback for the local
 * daemon, the remote controller's own host for anything else — a remote
 * proxy never lives on this machine's loopback.
 */
export function proxyEndpoint(
  isLocal: boolean,
  hostname: string | undefined,
  port: number | string | undefined,
): string {
  const resolved = port || 7890;
  return isLocal
    ? `127.0.0.1:${resolved}`
    : hostname
      ? `${hostname}:${resolved}`
      : `:${resolved}`;
}

export type ProxyTerminalFormat = "powershell" | "cmd" | "bash";

export function proxyTerminalCommand(
  format: ProxyTerminalFormat,
  endpoint: string,
): string {
  switch (format) {
    case "powershell":
      return `$env:all_proxy="http://${endpoint}"`;
    case "cmd":
      return `set all_proxy=http://${endpoint}`;
    case "bash":
      return `export all_proxy="http://${endpoint}"`;
  }
}
