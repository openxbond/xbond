import { cloudSubscription, type AccountStatus } from "@xbond/client/localapi";
import { useCallback, useEffect } from "react";
import useSWR, { useSWRConfig } from "swr";

import { useConfigurationOperation } from "./configuration-operation";
import { useDaemonConnection } from "./daemon";
import { useSubscriptions } from "./localapi";

/**
 * Daemon-owned XBond account session. The OAuth token never reaches the UI;
 * this hook only exposes login state and the actions LocalAPI offers.
 */
export function useAccount() {
  const { client, config } = useDaemonConnection();
  const { subscriptions, selectCloud } = useSubscriptions();
  const { mutate: mutateCache } = useSWRConfig();
  const { run: runOperation } = useConfigurationOperation();
  const { data, error, mutate } = useSWR<AccountStatus>(
    client && config
      ? ["/localapi/v0/account", config.endpoint, config.token]
      : null,
    () => {
      if (!client) throw new Error("LocalAPI not available");
      return client.accountStatus();
    },
    {
      // Fast-poll only while an authorization is pending; otherwise the
      // LocalAPI status refresh drives state changes.
      refreshInterval: (latest: AccountStatus | undefined) =>
        latest?.status === "pending" || latest?.phase ? 1000 : 4000,
      shouldRetryOnError: false,
    },
  );

  useEffect(() => {
    if (config && data?.status)
      void mutateCache(["/localapi/v0/subs", config.endpoint, config.token]);
  }, [
    data?.status,
    data?.subscription?.id,
    data?.subscription?.lastUpdated,
    data?.updateError,
    config,
    mutateCache,
  ]);

  const login = useCallback(
    async (options?: { origin?: string; device?: boolean }) => {
      if (!client) throw new Error("LocalAPI not available");
      const status = await client.accountLogin(options);
      await mutate();
      return status;
    },
    [client, mutate],
  );

  /** Aborts an in-flight login; required before switching methods (the
   * daemon refuses a new flow while one is pending). */
  const cancelLogin = useCallback(async () => {
    if (!client) throw new Error("LocalAPI not available");
    const status = await client.accountCancel();
    await mutate();
    return status;
  }, [client, mutate]);

  const logout = useCallback(async () => {
    if (!client) throw new Error("LocalAPI not available");
    const res = await client.accountLogout();
    await mutate();
    return res;
  }, [client, mutate]);

  // Re-resolves the subscription link with the saved session and binds it —
  // the recovery path after a purchase or a temporary Cloud failure.
  const resync = useCallback(
    () =>
      runOperation("sync", async () => {
        if (!client) throw new Error("LocalAPI not available");
        const status = await client.accountRefresh();
        await mutate();
        return status;
      }),
    [client, mutate, runOperation],
  );

  const cloudProfile = cloudSubscription(subscriptions, data?.subscription);
  const activateCloud = useCallback(
    () => selectCloud(cloudProfile),
    [cloudProfile, selectCloud],
  );

  return {
    account: data ?? null,
    // `ready` distinguishes "no session" from "not fetched yet" so the
    // onboarding gate never flashes for signed-in users.
    accountReady: data !== undefined,
    accountError: error ?? null,
    mutateAccount: mutate,
    login,
    cancelLogin,
    logout,
    resync,
    cloudProfile,
    activateCloud,
  };
}
