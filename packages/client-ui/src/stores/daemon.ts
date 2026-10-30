import {
  detectLocalAPIConfig,
  isDesktopApp,
  resolveDesktopLocalAPIConfig,
} from "@lib/localapi-bootstrap";
import {
  LocalAPIClient,
  type LocalAPIConfig,
  type LocalAPIStatusResponse,
} from "@xbond/client/localapi";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

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
  const lastReresolveAt = useRef(0);

  useEffect(() => {
    if (!config) {
      resolveDesktopLocalAPIConfig().then((desktopCfg) => {
        if (desktopCfg) {
          setConfig(desktopCfg);
        }
      });
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

  return {
    client,
    config,
    data: data ?? null,
    error: error ?? null,
    mutateStatus: mutate,
    hasDaemon: Boolean(client && data && !error),
  };
}
