import {
  LocalAPIClient,
  type LocalAPIConfig,
  type LocalAPIStatusResponse,
} from "@xbond/client/localapi";
import { atom, useAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
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

  const { data, error, mutate } = useSWR<LocalAPIStatusResponse>(
    client ? ["/localapi/v0/status", config?.token] : null,
    async () => {
      if (!client) throw new Error("No LocalAPI client");
      const res = await client.getStatus();
      setCachedStatus(res);
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
    : !config || error
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
