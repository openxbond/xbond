import type {
  LocalAPIPreferences,
  RoutingMode,
  TakeoverMode,
} from "@xbond/client/localapi";
import { useCallback } from "react";

import { useAPIInfo } from "./controller-target";
import { useDaemonConnection } from "./daemon-connection";

/** UAC / osascript consent is human-paced; generous but bounded. */
const SERVICE_CHANGE_TIMEOUT_MS = 60_000;

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
    reconnect,
    hasDaemon,
    daemonState,
  } = useDaemonConnection();
  const { targetKind } = useAPIInfo();
  const isLocalTarget = targetKind === "daemon";
  const hasLocalAPI = isLocalTarget && hasDaemon;
  const client = hasDaemon ? daemonClient : null;

  /**
   * 状态读回是尽力而为：动作本身已被 daemon 确认（POST 已 ack），读回
   * 请求恰好撞上核心停止时的连接撕除、被客户端网络层丢掉，不该把成功
   * 的动作误报成失败——4s 轮询与离线滞回会把界面追上事实。
   */
  const refreshQuietly = useCallback(async () => {
    try {
      await mutateStatus();
    } catch {
      // 轮询与 self-heal 兜底
    }
  }, [mutateStatus]);

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
      await refreshQuietly();
      return res;
    },
    [daemonClient, refreshQuietly],
  );

  const down = useCallback(async () => {
    if (!daemonClient) throw new Error("LocalAPI not available");
    const res = await daemonClient.down().catch((error: unknown) => {
      if (!(error instanceof TypeError)) throw error;
      return error;
    });

    // Restoring the system proxy can interrupt the response. Read the
    // daemon's current state without sending a second stop request.
    for (const delay of [0, 300]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const status = await mutateStatus(
        () => daemonClient.getStatus(),
        false,
      ).catch(() => undefined);
      if (status && !(res instanceof TypeError)) return res;
      if (status?.engine.running === false) return { ok: true };
    }

    void mutateStatus().catch(() => undefined);
    if (res instanceof TypeError) throw res;
    return res;
  }, [daemonClient, mutateStatus]);

  const restart = useCallback(async () => {
    if (!daemonClient) throw new Error("LocalAPI not available");
    const res = await daemonClient.restart();
    await refreshQuietly();
    return res;
  }, [daemonClient, refreshQuietly]);

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
      if (res?.preferences) {
        await mutateStatus(
          (prev) => (prev ? { ...prev, preferences: res.preferences! } : prev),
          false,
        );
      } else {
        await mutateStatus();
      }
      return res;
    },
    [daemonClient, mutateStatus],
  );

  /** Shared tail of reassert/release: the daemon answers with the updated
   * preferences, so the optimistic patch mirrors setMode. */
  const applySysproxyAction = useCallback(
    async (
      pending: Promise<{ ok: boolean; preferences?: LocalAPIPreferences }>,
    ) => {
      const res = await pending;
      if (res?.preferences) {
        await mutateStatus(
          (prev) => (prev ? { ...prev, preferences: res.preferences! } : prev),
          false,
        );
      } else {
        await mutateStatus();
      }
      return res;
    },
    [mutateStatus],
  );

  const reassertSystemProxy = useCallback(async () => {
    if (!daemonClient) throw new Error("LocalAPI not available");
    return applySysproxyAction(daemonClient.reassertSystemProxy());
  }, [daemonClient, applySysproxyAction]);

  const releaseSystemProxy = useCallback(async () => {
    if (!daemonClient) throw new Error("LocalAPI not available");
    return applySysproxyAction(daemonClient.releaseSystemProxy());
  }, [daemonClient, applySysproxyAction]);

  const selectNode = useCallback(
    async (group: string, node: string) => {
      if (!daemonClient) throw new Error("LocalAPI not available");
      return daemonClient.selectNode(group, node);
    },
    [daemonClient],
  );

  /**
   * Installs or removes the privileged system service. The platform raises
   * its native elevation prompt (UAC / osascript) and the API returns once
   * the elevated helper is launched, so the outcome is confirmed by polling
   * the daemon's own `serviceInstalled` fact. Resolves false when it never
   * flipped (prompt declined or helper failed) — never assumes success.
   */
  const changeService = useCallback(
    async (install: boolean) => {
      if (!daemonClient) throw new Error("LocalAPI not available");
      const res = install
        ? await daemonClient.installService()
        : await daemonClient.uninstallService();
      if (!res?.ok) throw new Error(res?.message || "service change failed");
      const deadline = Date.now() + SERVICE_CHANGE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const updated = await mutateStatus();
        if (Boolean(updated?.capabilities?.serviceInstalled) === install)
          return true;
      }
      return false;
    },
    [daemonClient, mutateStatus],
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
    reconnect,
    up,
    down,
    restart,
    setMode,
    reassertSystemProxy,
    releaseSystemProxy,
    selectNode,
    changeService,
  };
}
