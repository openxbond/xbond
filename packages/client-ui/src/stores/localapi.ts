import type { TakeoverMode, RoutingMode } from "@xbond/client/localapi";
import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";

import { useDaemonConnection } from "./daemon";
import {
  DAEMON_CONTROLLER_ID,
  useAPIInfo,
  useSelectController,
} from "./request";

/**
 * Daemon-backed actions plus the view-level distinction between the local
 * daemon core and an externally selected controller. Connection state and
 * self-heal live in useDaemonConnection; the daemon's clash endpoint details
 * (random port + random secret) are composed in useClient from status and
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

export function useSubscriptions() {
  // Subscriptions are daemon-owned: they stay manageable regardless of which
  // controller the window is currently viewing.
  const { client, config } = useDaemonConnection();
  const selectController = useSelectController();
  const { mutate: mutateCache } = useSWRConfig();
  const { data, error, mutate } = useSWR(
    client && config
      ? ["/localapi/v0/subs", config.endpoint, config.token]
      : null,
    async () => {
      if (!client) return { subscriptions: [], activeId: "" };
      return client.listSubs();
    },
  );

  const addSub = useCallback(
    async (params: {
      token?: string;
      urlOrFile?: string;
      content?: string;
      updateIntervalHours?: number;
      name?: string;
      protocol?: string;
      lang?: string;
    }) => {
      if (!client) throw new Error("LocalAPI not available");
      const res = await client.addSub(params);
      await mutate();
      return res;
    },
    [client, mutate],
  );

  const selectSub = useCallback(
    async (id: string) => {
      if (!client) throw new Error("LocalAPI not available");
      const res = await client.useSub(id);
      await mutate();
      await mutateCache(["/localapi/v0/status", config?.token]);
      selectController(DAEMON_CONTROLLER_ID);
      return res;
    },
    [client, config?.token, mutate, mutateCache, selectController],
  );

  const updateSub = useCallback(
    async (id?: string) => {
      if (!client) throw new Error("LocalAPI not available");
      const res = await client.updateSub(id);
      await mutate();
      return res;
    },
    [client, mutate],
  );

  const removeSub = useCallback(
    async (id: string) => {
      if (!client) throw new Error("LocalAPI not available");
      const res = await client.removeSub(id);
      await mutate();
      return res;
    },
    [client, mutate],
  );

  const renameSub = useCallback(
    async (id: string, name: string) => {
      if (!client) throw new Error("LocalAPI not available");
      const result = await client.renameSub(id, name);
      await mutate();
      return result;
    },
    [client, mutate],
  );

  return {
    subscriptions: data?.subscriptions ?? [],
    activeId: data?.activeId ?? "",
    isLoading: !data && !error,
    error,
    refresh: mutate,
    addSub,
    selectSub,
    updateSub,
    removeSub,
    renameSub,
  };
}
