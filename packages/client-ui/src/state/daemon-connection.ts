import {
  LocalAPIClient,
  type LocalAPIConfig,
  type LocalAPIStatusResponse,
} from "@xbond/client/localapi";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import {
  detectLocalAPIConfig,
  isDesktopApp,
  resolveDesktopLocalAPIConfig,
} from "@/platform/local-api-bootstrap";

/**
 * Connection core for the daemon that owns this window: config resolution
 * (desktop IPC with self-heal), the LocalAPI client, and the status poll.
 * Controller/identity concerns stay in stores/request; daemon-owned details
 * (random clash port + secret) are consumed from status, never persisted.
 */
export function useDaemonConnection() {
  const [config, setConfig] = useState<LocalAPIConfig | null>(() =>
    detectLocalAPIConfig(),
  );
  // Desktop resolves its injected config over IPC asynchronously. Until that
  // settles, "no client" means connecting, not a down daemon.
  const [configReady, setConfigReady] = useState(
    () => Boolean(detectLocalAPIConfig()) || !isDesktopApp(),
  );
  const lastReresolveAt = useRef(0);

  useEffect(() => {
    if (!config && isDesktopApp()) {
      // The daemon may still be starting, or a live instance may still have
      // to release the state lock before a spawn can succeed: keep re-reading
      // the desktop config instead of going offline on the first empty
      // answer. Fast retries stay in "connecting"; after the fast window the
      // UI turns "offline" while a slow lane keeps watching for a daemon that
      // comes up much later (e.g. the shell's spawn backoff succeeding).
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let attempts = 0;
      const attempt = () => {
        attempts += 1;
        void resolveDesktopLocalAPIConfig().then((desktopCfg) => {
          if (cancelled) return;
          if (desktopCfg) {
            setConfig(desktopCfg);
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

  // Self-heal: the daemon may have been restarted (or reinstalled) with a
  // fresh addr/token since this window resolved its config. Re-read it from
  // the desktop shell when the status keeps failing; a changed config flips
  // the SWR key and reconnects. Throttled so a down daemon doesn't poll IPC.
  useEffect(() => {
    if (!isDesktopApp() || !config || !error) return;
    if (Date.now() - lastReresolveAt.current < 10_000) return;
    lastReresolveAt.current = Date.now();
    const timer = setTimeout(() => {
      void resolveDesktopLocalAPIConfig().then((next) => {
        if (
          next &&
          (next.endpoint !== config.endpoint || next.token !== config.token)
        ) {
          setConfig(next);
        }
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [error, config]);

  const daemonState = !configReady
    ? ("connecting" as const)
    : !config || error
      ? ("offline" as const)
      : !data
        ? ("connecting" as const)
        : ("ready" as const);

  return {
    client,
    config,
    data: data ?? null,
    error: error ?? null,
    mutateStatus: mutate,
    hasDaemon: daemonState === "ready",
    daemonState,
  };
}
