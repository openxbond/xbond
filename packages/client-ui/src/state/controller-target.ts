import {
  migrateControllers,
  normalizeControllerURL,
  resolveControlTarget,
  type Controller,
} from "@xbond/client/controller";
import { Client } from "@xbond/client/request";
import { atom, useAtom, useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useMemo, useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { isClashX, jsBridge } from "@/platform/clashx-bridge";

import { useDaemonConnection } from "./daemon-connection";

function readStorage(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
const fallback: Controller = {
  id: "default",
  name: "XBond",
  secret: "",
  url: window.location.pathname.startsWith("/ui")
    ? window.location.origin
    : "http://127.0.0.1:9090",
};
/** The built-in controller backed by this window's own daemon. */
export const DAEMON_CONTROLLER_ID = fallback.id;
const initialHosts = migrateControllers(
  readStorage("externalControllers"),
  fallback,
);
const oldIndex = Number(readStorage("externalControllerIndex") ?? 0);
export const hostsStorageAtom = atomWithStorage<Controller[]>(
  "controllers.v2",
  initialHosts,
  undefined,
  { getOnInit: true },
);
export const selectedControllerAtom = atomWithStorage<string>(
  "controller.selected.v2",
  initialHosts[oldIndex]?.id ?? initialHosts[0].id,
  undefined,
  { getOnInit: true },
);
export function useControllers() {
  const [saved, set] = useAtom(hostsStorageAtom);
  const hosts = useMemo(() => migrateControllers(saved, fallback), [saved]);
  return [hosts, set] as const;
}
export function useSelectController() {
  const [, set] = useAtom(selectedControllerAtom);
  const location = useLocation();
  const navigate = useNavigate();
  return useCallback(
    (id: string) => {
      const qs = new URLSearchParams(location.search);
      for (const name of ["host", "port", "secret", "protocol"])
        qs.delete(name);
      document.querySelector('meta[name="external-controller"]')?.remove();
      set(id);
      navigate(
        { pathname: location.pathname, search: qs.toString() },
        { replace: true },
      );
    },
    [location, navigate, set],
  );
}
const clashxConfigAtom = atom(async () => {
  if (!isClashX()) return null;
  const info = await jsBridge!.getAPIInfo();
  return {
    id: "clashx",
    name: "ClashX",
    url: normalizeControllerURL(`http://${info.host}:${info.port}`),
    secret: info.secret,
  };
});
// The page's injected metadata is static; the daemon's endpoint is not.
// Keep a successfully verified binding in memory across daemon restarts.
const verifiedDaemonMetaAtom = atom<string | undefined>(undefined);
export function useAPIInfo() {
  const clashx = useAtomValue(clashxConfigAtom);
  const { data, config } = useDaemonConnection();
  const [verifiedMeta, setVerifiedMeta] = useAtom(verifiedDaemonMetaAtom);
  const location = useLocation();
  const selected = useAtomValue(selectedControllerAtom);
  const saved = useAtomValue(hostsStorageAtom);
  const hosts = useMemo(() => migrateControllers(saved, fallback), [saved]);
  const info = useMemo(() => {
    const savedController = hosts.find((h) => h.id === selected) ?? hosts[0];
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="external-controller"]',
    );
    const { controller, kind, endpoint } = resolveControlTarget(
      savedController,
      {
        meta: meta?.content,
        search: location.search,
        bridge: clashx,
        daemon: config
          ? {
              id: DAEMON_CONTROLLER_ID,
              verifiedMeta,
              core: data
                ? {
                    url: `http://127.0.0.1:${data.preferences.clashPort}`,
                    secret: data.preferences.clashSecret ?? "",
                  }
                : undefined,
            }
          : null,
      },
    );
    const url = new URL(controller.url);
    return {
      ...controller,
      endpoint,
      targetKind: kind,
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? "443" : "80"),
      protocol: url.protocol,
    };
  }, [clashx, hosts, selected, location.search, data, config, verifiedMeta]);
  useEffect(() => {
    if (info.targetKind !== "daemon" || !data) return;
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="external-controller"]',
    )?.content;
    if (meta) setVerifiedMeta(meta);
  }, [info.targetKind, data, setVerifiedMeta]);
  return info;
}
export function useClient() {
  const {
    endpoint: { url, secret },
  } = useAPIInfo();
  return useMemo(() => Client.forController(url, secret), [url, secret]);
}

export const identityAtom = atom(true);
