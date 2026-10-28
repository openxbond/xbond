import {
  controllerFromQuery,
  migrateControllers,
  normalizeControllerURL,
  type Controller,
} from "@lib/controller";
import { isClashX, jsBridge } from "@lib/jsBridge";
import { Client } from "@lib/request";
import { atom, useAtom, useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useMemo, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

function readStorage(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
const fallback: Controller = {
  id: "default",
  name: "",
  secret: "",
  url: window.location.pathname.startsWith("/ui")
    ? window.location.origin
    : "http://127.0.0.1:9090",
};
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
export function useAPIInfo() {
  const clashx = useAtomValue(clashxConfigAtom);
  const location = useLocation();
  const selected = useAtomValue(selectedControllerAtom);
  const saved = useAtomValue(hostsStorageAtom);
  const hosts = useMemo(() => migrateControllers(saved, fallback), [saved]);
  return useMemo(() => {
    let controller = hosts.find((h) => h.id === selected) ?? hosts[0];
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="external-controller"]',
    );
    if (meta?.content) {
      try {
        const url = new URL(meta.content);
        const secret = decodeURIComponent(url.username);
        url.username = "";
        url.password = "";
        controller = {
          ...controller,
          url: normalizeControllerURL(url.toString()),
          secret,
        };
      } catch {
        /* Keep the usable saved controller. */
      }
    }
    if (clashx) controller = clashx;
    else {
      try {
        controller = controllerFromQuery(location.search, controller);
      } catch {
        /* Ignore invalid launch parameters. */
      }
    }
    const url = new URL(controller.url);
    return {
      ...controller,
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? "443" : "80"),
      protocol: url.protocol,
    };
  }, [clashx, hosts, selected, location.search]);
}
export function useClient() {
  const { url, secret } = useAPIInfo();
  return useMemo(() => Client.forController(url, secret), [url, secret]);
}
