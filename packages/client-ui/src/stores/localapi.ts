import {
  detectLocalAPIConfig,
  resolveDesktopLocalAPIConfig,
} from "@lib/localapi-bootstrap";
import {
  LocalAPIClient,
  type LocalAPIConfig,
  type LocalAPIStatusResponse,
  type TakeoverMode,
  type RoutingMode,
} from "@xbond/client/localapi";
import { isDaemonController } from "@xbond/client/workspace";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { useAPIInfo } from "./request";

export function useLocalAPI() {
  const controller = useAPIInfo();
  const [config, setConfig] = useState<LocalAPIConfig | null>(() =>
    detectLocalAPIConfig(),
  );

  useEffect(() => {
    if (!config) {
      resolveDesktopLocalAPIConfig().then((desktopCfg) => {
        if (desktopCfg) {
          setConfig(desktopCfg);
        }
      });
    }
  }, [config]);

  const client = useMemo(() => {
    if (!config) return null;
    return new LocalAPIClient(config.endpoint, config.token);
  }, [config]);

  const { data, error, mutate } = useSWR<LocalAPIStatusResponse>(
    client ? ["/localapi/v0/status", config?.token] : null,
    async () => {
      if (!client) throw new Error("No LocalAPI client");
      return client.getStatus();
    },
    {
      refreshInterval: 4000,
      shouldRetryOnError: false,
    },
  );

  const isLocalTarget = isDaemonController(
    controller.url,
    data?.preferences.clashPort,
  );
  const hasLocalAPI = Boolean(client && data && !error && isLocalTarget);

  const up = useCallback(
    async (options?: {
      mode?: TakeoverMode;
      routing?: RoutingMode;
      port?: number;
      allowLan?: boolean;
      subId?: string;
    }) => {
      if (!client) return;
      const res = await client.up(options);
      await mutate();
      return res;
    },
    [client, mutate],
  );

  const down = useCallback(async () => {
    if (!client) return;
    const res = await client.down();
    await mutate();
    return res;
  }, [client, mutate]);

  const restart = useCallback(async () => {
    if (!client) return;
    const res = await client.restart();
    await mutate();
    return res;
  }, [client, mutate]);

  const setMode = useCallback(
    async (options: {
      mode?: TakeoverMode;
      routing?: RoutingMode;
      port?: number;
      allowLan?: boolean;
    }) => {
      if (!client) return;
      const res = await client.setMode(options);
      await mutate();
      return res;
    },
    [client, mutate],
  );

  const selectNode = useCallback(
    async (group: string, node: string) => {
      if (!client) return;
      return client.selectNode(group, node);
    },
    [client],
  );

  return {
    hasLocalAPI,
    isLocalTarget,
    config,
    client,
    status: data ?? null,
    error,
    refresh: mutate,
    up,
    down,
    restart,
    setMode,
    selectNode,
  };
}

export function useSubscriptions() {
  const { client, hasLocalAPI } = useLocalAPI();
  const { data, error, mutate } = useSWR(
    client && hasLocalAPI ? ["/localapi/v0/subs", client] : null,
    async () => {
      if (!client) return { subscriptions: [], activeId: "" };
      return client.listSubs();
    },
  );

  const addSub = useCallback(
    async (params: {
      token?: string;
      urlOrFile?: string;
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
