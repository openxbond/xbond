import { partition } from "@xbond/client/helper";
import type * as API from "@xbond/client/request";
import { produce } from "immer";
import { useCallback, useMemo } from "react";
import useSWR from "swr";

import { useClient } from "@/state/controller-target";
import { useCapabilities } from "@/state/core-settings";

export function useProxyProviders() {
  const client = useClient();
  const capabilities = useCapabilities();
  const { data, mutate, error } = useSWR(
    capabilities.proxyProviders && client
      ? ["/providers/proxies", client]
      : null,
    async () => {
      if (!client) throw new Error("No core client");
      return Object.values(
        (await client.getProxyProviders()).data.providers ?? {},
      ).filter((p) => p.name !== "default" && p.vehicleType !== "Compatible");
    },
  );
  return { providers: data ?? [], update: mutate, error };
}

interface ProxyState {
  proxies: API.Proxy[];
  groups: API.Group[];
  global: API.Group;
}
const emptyProxies: ProxyState = {
  proxies: [],
  groups: [],
  global: { name: "GLOBAL", type: "Fallback", all: [], now: "", history: [] },
};
export function useProxy() {
  const client = useClient();
  const { data, mutate, error } = useSWR(
    client ? ["/proxies", client] : null,
    async () => {
      if (!client) throw new Error("No core client");
      const mapping = (await client.getProxies()).data.proxies ?? {};
      const global = {
        ...emptyProxies.global,
        ...mapping.GLOBAL,
        name: "GLOBAL",
      } as API.Group;
      const entries = (global.all.length ? global.all : Object.keys(mapping))
        .filter(
          (name) =>
            !["GLOBAL", "DIRECT", "REJECT"].includes(name) && mapping[name],
        )
        .map((name) => ({
          ...mapping[name],
          name,
          history: mapping[name].history ?? [],
        }));
      const [proxies, groups] = partition(entries, (p) => !("all" in p));
      return {
        proxies: proxies as API.Proxy[],
        groups: groups as API.Group[],
        global,
      };
    },
  );
  const set = useCallback(
    (update: (draft: ProxyState) => void) => {
      void mutate((current) => produce(current ?? emptyProxies, update), {
        revalidate: false,
      });
    },
    [mutate],
  );
  const markProxySelected = useCallback(
    (name: string, selected: string) => {
      set((draft) => {
        if (name === "GLOBAL") draft.global.now = selected;
        for (const group of draft.groups)
          if (group.name === name) group.now = selected;
      });
    },
    [set],
  );
  return {
    ...(data ?? emptyProxies),
    update: mutate,
    markProxySelected,
    set,
    error,
    // 首次載入與「沒有策略組」不同：空狀態在載入期間不能誤報。
    isLoading: data === undefined,
  };
}
export function useProxyMapping() {
  const { proxies, groups, global } = useProxy();
  const { providers } = useProxyProviders();
  return useMemo(() => {
    const mapping = new Map<string, API.Proxy | API.Group>();
    for (const item of [
      ...proxies,
      ...groups,
      global,
      ...providers.flatMap((p) => p.proxies),
    ])
      mapping.set(item.name, item);
    return mapping;
  }, [proxies, groups, global, providers]);
}
