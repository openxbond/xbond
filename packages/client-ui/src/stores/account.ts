import type { AccountStatus } from "@xbond/client/localapi";
import { useCallback } from "react";
import useSWR from "swr";

import { useDaemonConnection } from "./daemon";

/**
 * Daemon-owned XBond account session. The OAuth token never reaches the UI;
 * this hook only exposes login state and the actions LocalAPI offers.
 */
export function useAccount() {
  const { client, hasDaemon } = useDaemonConnection();
  const { data, error, mutate } = useSWR<AccountStatus>(
    client && hasDaemon ? ["/localapi/v0/account", client] : null,
    () => {
      if (!client) throw new Error("LocalAPI not available");
      return client.accountStatus();
    },
    {
      // Fast-poll only while an authorization is pending; otherwise the
      // LocalAPI status refresh drives state changes.
      refreshInterval: (latest: AccountStatus | undefined) =>
        latest?.status === "pending" ? 1000 : 0,
      shouldRetryOnError: false,
    },
  );

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
  const resync = useCallback(async () => {
    if (!client) throw new Error("LocalAPI not available");
    const status = await client.accountRefresh();
    await mutate();
    return status;
  }, [client, mutate]);

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
  };
}
