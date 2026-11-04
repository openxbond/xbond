import {
  subscriptionLang,
  type SubscriptionMeta,
} from "@xbond/client/localapi";
import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";

import {
  DAEMON_CONTROLLER_ID,
  useSelectController,
} from "@/state/controller-target";
import { useDaemonConnection } from "@/state/daemon-connection";
import { useLanguage } from "@/state/user-preferences";

import { useConfigurationOperation } from "../configuration-operation";

export function useSubscriptions() {
  // Subscriptions are daemon-owned: they stay manageable regardless of which
  // controller the window is currently viewing.
  const { client, config } = useDaemonConnection();
  const selectController = useSelectController();
  const { operation, run: runOperation } = useConfigurationOperation();
  const { lang } = useLanguage();
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
          const refreshed = await client.accountRefresh({
            lang: subscriptionLang(lang),
          });
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
    [
      activate,
      client,
      config?.endpoint,
      config?.token,
      lang,
      mutate,
      mutateCache,
    ],
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
