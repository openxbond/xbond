import type { RoutingMode, TakeoverMode } from "@xbond/client/localapi";
import { useCallback } from "react";

import { useAPIInfo } from "./controller-target";
import { useDaemonConnection } from "./daemon-connection";

/** UAC / osascript consent is human-paced; generous but bounded. */
const SERVICE_CHANGE_TIMEOUT_MS = 60_000;

/**
 * Daemon-backed actions plus the view-level distinction between the local
 * daemon core and an externally selected controller. Connection state and
 * self-heal live in useDaemonConnection; the daemon's clash endpoint details
 * (random port + random secret) are resolved in useAPIInfo from status and
 * never surfaced here.
 */
export function useLocalAPI() {
  const {
    client: daemonClient,
    config,
    data,
    error,
    mutateStatus,
    hasDaemon,
    daemonState,
  } = useDaemonConnection();
  const { targetKind } = useAPIInfo();
  const isLocalTarget = targetKind === "daemon";
  const hasLocalAPI = isLocalTarget && hasDaemon;
  const client = hasDaemon ? daemonClient : null;

  const up = useCallback(
    async (options?: {
      mode?: TakeoverMode;
      routing?: RoutingMode;
      port?: number;
      allowLan?: boolean;
      subId?: string;
    }) => {
      if (!daemonClient) throw new Error("LocalAPI not available");
      const res = await daemonClient.up(options);
      await mutateStatus();
      return res;
    },
    [daemonClient, mutateStatus],
  );

  const down = useCallback(async () => {
    if (!daemonClient) throw new Error("LocalAPI not available");
    const res = await daemonClient.down();
    await mutateStatus();
    return res;
  }, [daemonClient, mutateStatus]);

  const restart = useCallback(async () => {
    if (!daemonClient) throw new Error("LocalAPI not available");
    const res = await daemonClient.restart();
    await mutateStatus();
    return res;
  }, [daemonClient, mutateStatus]);

  const setMode = useCallback(
    async (options: {
      systemProxy?: boolean;
      tun?: boolean;
      mode?: TakeoverMode;
      routing?: RoutingMode;
      port?: number;
      allowLan?: boolean;
    }) => {
      if (!daemonClient) throw new Error("LocalAPI not available");
      const res = await daemonClient.setMode(options);
      await mutateStatus();
      return res;
    },
    [daemonClient, mutateStatus],
  );

  const selectNode = useCallback(
    async (group: string, node: string) => {
      if (!daemonClient) throw new Error("LocalAPI not available");
      return daemonClient.selectNode(group, node);
    },
    [daemonClient],
  );

  /**
   * Installs or removes the privileged system service. The platform raises
   * its native elevation prompt (UAC / osascript) and the API returns once
   * the elevated helper is launched, so the outcome is confirmed by polling
   * the daemon's own `serviceInstalled` fact. Resolves false when it never
   * flipped (prompt declined or helper failed) — never assumes success.
   */
  const changeService = useCallback(
    async (install: boolean) => {
      if (!daemonClient) throw new Error("LocalAPI not available");
      const res = install
        ? await daemonClient.installService()
        : await daemonClient.uninstallService();
      if (!res?.ok) throw new Error(res?.message || "service change failed");
      const deadline = Date.now() + SERVICE_CHANGE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const updated = await mutateStatus();
        if (Boolean(updated?.capabilities?.serviceInstalled) === install)
          return true;
      }
      return false;
    },
    [daemonClient, mutateStatus],
  );

  return {
    hasLocalAPI,
    isLocalTarget,
    hasDaemon,
    daemonState,
    daemonClient,
    client,
    config,
    status: data,
    error,
    refresh: mutateStatus,
    up,
    down,
    restart,
    setMode,
    selectNode,
    changeService,
  };
}
