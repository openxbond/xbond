import type {
  GlobalMixin,
  SubscriptionMeta,
  TakeoverMode,
  RoutingMode,
} from "@xbond/client/localapi";
import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";

import { useConfigurationOperation } from "./configuration-operation";
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
  const { operation, run: runOperation } = useConfigurationOperation();
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
      return runOperation("sync", async () => {
        const res = await client.addSub(params);
        await mutate();
        return res;
      });
    },
    [client, mutate, runOperation],
  );

  const activate = useCallback(
    (resolveSource: () => Promise<string>) =>
      runOperation("use", async () => {
        if (!client) throw new Error("LocalAPI not available");
        const id = await resolveSource();
        const result = await client.useSub(id);
        await mutate(
          (current) =>
            current ? { ...current, activeId: result.activeId } : current,
          { revalidate: false },
        );
        selectController(DAEMON_CONTROLLER_ID);
        // The server has committed the switch. Refresh errors remain visible in
        // their SWR queries; they must not turn a successful switch into a failure.
        await Promise.allSettled([
          mutate(),
          mutateCache(["/localapi/v0/status", config?.token]),
        ]);
        return result;
      }),
    [
      client,
      config?.token,
      mutate,
      mutateCache,
      runOperation,
      selectController,
    ],
  );
  const selectSub = useCallback(
    (id: string) =>
      activate(async () => {
        if (!client) throw new Error("LocalAPI not available");
        const source = data?.subscriptions.find((item) => item.id === id);
        if (!source?.format) {
          await client.updateSub(id);
          const refreshed = await client.listSubs();
          const ready = refreshed.subscriptions.find((item) => item.id === id);
          if (!ready?.format)
            throw new Error(
              ready?.lastErrorMessage ||
                "Configuration is not ready. Update or edit it before use.",
            );
        }
        return id;
      }),
    [activate, client, data?.subscriptions],
  );
  const selectCloud = useCallback(
    (source?: SubscriptionMeta) =>
      activate(async () => {
        if (!client) throw new Error("LocalAPI not available");
        let ready = source;
        if (!ready?.format) {
          const refreshed = await client.accountRefresh();
          await Promise.allSettled([
            mutate(),
            mutateCache([
              "/localapi/v0/account",
              config?.endpoint,
              config?.token,
            ]),
          ]);
          if (refreshed.updateError) throw new Error(refreshed.updateError);
          ready = refreshed.subscription ?? undefined;
        }
        if (!ready?.format)
          throw new Error(
            "No usable Cloud configuration is available. Update the subscription and retry.",
          );
        return ready.id;
      }),
    [activate, client, config?.endpoint, config?.token, mutate, mutateCache],
  );

  const updateSub = useCallback(
    async (id?: string) => {
      if (!client) throw new Error("LocalAPI not available");
      return runOperation("sync", async () => {
        const res = await client.updateSub(id);
        await mutate();
        return res;
      });
    },
    [client, mutate, runOperation],
  );

  const removeSub = useCallback(
    async (id: string) => {
      if (!client) throw new Error("LocalAPI not available");
      return runOperation("sync", async () => {
        const res = await client.removeSub(id);
        await mutate();
        return res;
      });
    },
    [client, mutate, runOperation],
  );

  const renameSub = useCallback(
    async (id: string, name: string) => {
      if (!client) throw new Error("LocalAPI not available");
      return runOperation("sync", async () => {
        const result = await client.renameSub(id, name);
        await mutate();
        return result;
      });
    },
    [client, mutate, runOperation],
  );

  return {
    subscriptions: data?.subscriptions ?? [],
    activeId: data?.activeId ?? "",
    isLoading: !data && !error,
    error,
    refresh: mutate,
    addSub,
    selectSub,
    selectCloud,
    operation,
    updateSub,
    removeSub,
    renameSub,
  };
}

export function useGlobalMixin() {
  const { client, config } = useDaemonConnection();
  const { mutate: mutateCache } = useSWRConfig();
  const { data, error, mutate } = useSWR<GlobalMixin>(
    client && config
      ? ["/localapi/v0/mixins/global", config.endpoint, config.token]
      : null,
    async () => {
      if (!client)
        return { bypassLan: false, rulesPrepend: [], rulesAppend: [], dns: "" };
      return client.getGlobalMixin();
    },
  );

  const updateMixin = useCallback(
    async (mixin: GlobalMixin) => {
      if (!client) throw new Error("LocalAPI not available");
      const res = await client.setGlobalMixin(mixin);
      await mutate(mixin, { revalidate: true });
      await mutateCache(["/localapi/v0/status", config?.token]);
      return res;
    },
    [client, config?.token, mutate, mutateCache],
  );

  return {
    mixin: data ?? {
      bypassLan: false,
      rulesPrepend: [],
      rulesAppend: [],
      dns: "",
    },
    isLoading: !data && !error,
    error,
    updateMixin,
    refresh: mutate,
  };
}

export function useSubscriptionFetchProgress(active = false) {
  const { client, config } = useDaemonConnection();
  const { data } = useSWR(
    client && config && active
      ? ["/localapi/v0/subs/progress", config.endpoint, config.token]
      : null,
    async () => {
      if (!client) return { active: false, bytes: 0, total: 0 };
      return client.subscriptionProgress();
    },
    {
      refreshInterval: active ? 250 : 0,
      dedupingInterval: 150,
    },
  );

  return data ?? { active: false, bytes: 0, total: 0 };
}
