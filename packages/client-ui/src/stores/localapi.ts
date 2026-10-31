import type { TakeoverMode, RoutingMode } from "@xbond/client/localapi";
import { useCallback } from "react";
import useSWR from "swr";

import { useDaemonConnection } from "./daemon";
import { useAPIInfo } from "./request";

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
  } = useDaemonConnection();
  const { targetKind } = useAPIInfo();
  const isLocalTarget = targetKind === "daemon";
  const hasLocalAPI = isLocalTarget && hasDaemon;
  const client = hasLocalAPI ? daemonClient : null;

  const up = useCallback(
    async (options?: {
      mode?: TakeoverMode;
      routing?: RoutingMode;
      port?: number;
      allowLan?: boolean;
      subId?: string;
    }) => {
      if (!client) throw new Error("Selected target has no LocalAPI");
      const res = await client.up(options);
      await mutateStatus();
      return res;
    },
    [client, mutateStatus],
  );

  const down = useCallback(async () => {
    if (!client) throw new Error("Selected target has no LocalAPI");
    const res = await client.down();
    await mutateStatus();
    return res;
  }, [client, mutateStatus]);

  const restart = useCallback(async () => {
    if (!client) throw new Error("Selected target has no LocalAPI");
    const res = await client.restart();
    await mutateStatus();
    return res;
  }, [client, mutateStatus]);

  const setMode = useCallback(
    async (options: {
      mode?: TakeoverMode;
      routing?: RoutingMode;
      port?: number;
      allowLan?: boolean;
    }) => {
      if (!client) throw new Error("Selected target has no LocalAPI");
      const res = await client.setMode(options);
      await mutateStatus();
      return res;
    },
    [client, mutateStatus],
  );

  const selectNode = useCallback(
    async (group: string, node: string) => {
      if (!client) throw new Error("Selected target has no LocalAPI");
      return client.selectNode(group, node);
    },
    [client],
  );

  return {
    hasLocalAPI,
    isLocalTarget,
    hasDaemon,
    client,
    config: isLocalTarget ? config : null,
    status: isLocalTarget ? data : null,
    error: isLocalTarget ? error : null,
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
  const { client, hasDaemon } = useDaemonConnection();
  const { data, error, mutate } = useSWR(
    client && hasDaemon ? ["/localapi/v0/subs", client] : null,
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
      clashNodesOnly?: boolean;
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
      return res;
    },
    [client, mutate],
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
