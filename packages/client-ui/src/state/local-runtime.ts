import type { RoutingMode, TakeoverMode } from "@xbond/client/localapi";
import { useCallback } from "react";

import { useAPIInfo } from "./controller-target";
import { useDaemonConnection } from "./daemon-connection";

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
  };
}
