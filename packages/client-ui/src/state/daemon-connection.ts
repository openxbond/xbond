import {
  LocalAPIClient,
  type LocalAPIConfig,
  type LocalAPIStatusResponse,
} from "@xbond/client/localapi";
import { atom, useAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { isTauriRuntime } from "@/platform/host";
import {
  detectLocalAPIConfig,
  resolveShellLocalAPIConfig,
} from "@/platform/local-api-bootstrap";

/** Retain resolved daemon config globally so route changes don't re-probe IPC or drop clients. */
const daemonConfigAtom = atom<LocalAPIConfig | null>(detectLocalAPIConfig());
const daemonConfigReadyAtom = atom<boolean>(
  Boolean(detectLocalAPIConfig()) || !isTauriRuntime(),
);
const daemonStatusAtom = atom<LocalAPIStatusResponse | null>(null);

let globalLastReresolveAt = 0;
const STATUS_POLL_MS = 4_000;
/** 最近一次成功读到状态的时刻：瞬时轮询失败用它做离线滞回。 */
let globalLastGoodStatusAt = 0;
/**
 * 断开连接这类操作本身会伴随一轮快速的状态变化，WebKit 网络层偶发把
 * 同一瞬间的轮询请求一起弄丢。一次失败不该把整页闪成离线卡片：持有
 * 未过期的缓存快照时，连续失败超过一个轮询窗口才承认 daemon 离线。
 */
const OFFLINE_GRACE_MS = 12_000;

/**
 * Connection core for the daemon that owns this window: config resolution
 * (Tauri IPC with self-heal), the LocalAPI client, and the status poll.
 * Controller/identity concerns stay in stores/request; daemon-owned details
 * (random clash port + secret) are consumed from status, never persisted.
 */
export function useDaemonConnection() {
  const [config, setConfig] = useAtom(daemonConfigAtom);
  const [configReady, setConfigReady] = useAtom(daemonConfigReadyAtom);
  const [cachedStatus, setCachedStatus] = useAtom(daemonStatusAtom);

  useEffect(() => {
    if (!config && isTauriRuntime()) {
      // The daemon may still be starting, or a live instance may still have
      // to release the state lock before a spawn can succeed: keep re-reading
      // the native config instead of going offline on the first empty
      // answer. Fast retries stay in "connecting"; after the fast window the
      // UI turns "offline" while a slow lane keeps watching for a daemon that
      // comes up much later (e.g. the shell's spawn backoff succeeding).
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let attempts = 0;
      const attempt = () => {
        attempts += 1;
        void resolveShellLocalAPIConfig().then((shellCfg) => {
          if (cancelled) return;
          if (shellCfg) {
            setConfig(shellCfg);
            setConfigReady(true);
          } else {
            if (attempts >= 15) {
              setConfigReady(true);
            }
            timer = setTimeout(attempt, attempts >= 15 ? 10_000 : 2000);
          }
        });
      };
      attempt();
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }
  }, [config, setConfig, setConfigReady]);

  const client = useMemo(() => {
    if (!config) return null;
    return new LocalAPIClient(config.endpoint, config.token);
  }, [config]);

  // 換了目标（endpoint/token 变化）就不能继承旧目标的滞回信用：
  // 新目标第一次失败要立刻走它自己的 connecting/offline 判定。
  useEffect(() => {
    globalLastGoodStatusAt = 0;
  }, [config?.endpoint, config?.token]);

  const [degraded, setDegraded] = useState(false);
  const { data, error, mutate } = useSWR<LocalAPIStatusResponse>(
    client ? ["/localapi/v0/status", config?.token] : null,
    async () => {
      if (!client) throw new Error("No LocalAPI client");
      const res = await client.getStatus();
      globalLastGoodStatusAt = Date.now();
      setCachedStatus(res);
      // 恢复由成功的轮询驱动；同值更新会 bail-out，不产生级联渲染。
      setDegraded(false);
      return res;
    },
    {
      refreshInterval: STATUS_POLL_MS,
      // SWR pauses interval revalidation while the cache has an error.
      onErrorRetry: (_error, _key, _config, retry, options) => {
        setTimeout(() => retry(options), STATUS_POLL_MS);
      },
      fallbackData: cachedStatus ?? undefined,
    },
  );

  const effectiveStatus = data ?? cachedStatus;

  /**
   * 离线的两个事实分开看：config 丢失立刻离线（没有可以读的对象）；
   * 轮询失败只有手上没有快照、或失败持续超过滞回窗口（以最后一次
   * 成功读取为基准）才承认离线。窗口内保留最后一份已知状态——
   * 断开连接等操作伴随的瞬时轮询失败不该把整页闪成离线卡片。
   */
  useEffect(() => {
    if (!error || !effectiveStatus) return; // 沒有快照時直接走 offline，不定時器。
    const remaining = Math.max(
      0,
      OFFLINE_GRACE_MS - (Date.now() - globalLastGoodStatusAt),
    );
    const timer = setTimeout(() => setDegraded(true), remaining);
    return () => clearTimeout(timer);
  }, [error, effectiveStatus]);
  const statusStale = Boolean(error) && (!effectiveStatus || degraded);

  // Self-heal: the daemon may have been restarted (or reinstalled) with a
  // fresh addr/token since this window resolved its config. Re-read it from
  // the shell when the status keeps failing; a changed config flips
  // the SWR key and reconnects. Throttled so a down daemon doesn't poll IPC.
  useEffect(() => {
    if (!isTauriRuntime() || !config || !error) return;
    if (Date.now() - globalLastReresolveAt < 10_000) return;
    globalLastReresolveAt = Date.now();
    const timer = setTimeout(() => {
      void resolveShellLocalAPIConfig().then((next) => {
        if (
          next &&
          (next.endpoint !== config.endpoint || next.token !== config.token)
        ) {
          setConfig(next);
        }
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [error, config, setConfig]);

  const daemonState = !configReady
    ? ("connecting" as const)
    : !config || statusStale
      ? ("offline" as const)
      : !effectiveStatus
        ? ("connecting" as const)
        : ("ready" as const);

  /** Manual retry entry: re-resolve the native config, then re-read status. */
  const reconnect = useCallback(async () => {
    if (!config && isTauriRuntime()) {
      const shellCfg = await resolveShellLocalAPIConfig();
      if (shellCfg) {
        setConfig(shellCfg);
        setConfigReady(true);
      }
    }
    if (client) await mutate();
  }, [config, client, setConfig, setConfigReady, mutate]);

  return {
    client,
    config,
    data: effectiveStatus ?? null,
    error: error ?? null,
    mutateStatus: mutate,
    reconnect,
    hasDaemon: daemonState === "ready",
    daemonState,
  };
}
