import type { GlobalMixin } from "@xbond/client/localapi";
import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";

import { useDaemonConnection } from "@/state/daemon-connection";

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
