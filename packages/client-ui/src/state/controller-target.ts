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
import { hasDaemonConfig } from "@/platform/local-api-bootstrap";

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
  // 純 Web 表單（daemon 服務的 /ui）以本源為預填。桌面宿主的真實端點由
  // daemon 提供（隨機端口 + 密鑰），佔位地址不得存在：空 URL = 沒有端點，
  // 內建條目只作「本機 daemon」的身份錨點，永不展示或請求佔位地址。
  url: window.location.pathname.startsWith("/ui") ? window.location.origin : "",
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
const clashxConfigAtom = atom<Controller | null>(null);
// The page's injected metadata is static; the daemon's endpoint is not.
// Keep a successfully verified binding in memory across daemon restarts.
const verifiedDaemonMetaAtom = atom<string | undefined>(undefined);
export function useAPIInfo() {
  const [clashx, setClashx] = useAtom(clashxConfigAtom);
  useEffect(() => {
    if (!isClashX() || !jsBridge || clashx) return;
    void jsBridge.getAPIInfo().then((info) => {
      setClashx({
        id: "clashx",
        name: "ClashX",
        url: normalizeControllerURL(`http://${info.host}:${info.port}`),
        secret: info.secret,
      });
    });
  }, [clashx, setClashx]);
  const { data } = useDaemonConnection();
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
    const daemonCore = data
      ? {
          url: `http://127.0.0.1:${data.preferences.clashPort}`,
          secret: data.preferences.clashSecret ?? "",
        }
      : undefined;
    const { controller, kind, endpoint } = resolveControlTarget(
      savedController,
      {
        meta: meta?.content,
        search: location.search,
        bridge: clashx,
        // 宿主聲明了 daemon 身份：LocalAPI 尚未連通時內建目標仍保留本機身份
        // （供離線處理），端點可信度由 resolveControlTarget 判定。
        daemon: hasDaemonConfig()
          ? { id: DAEMON_CONTROLLER_ID, verifiedMeta, core: daemonCore }
          : null,
      },
    );
    const url = controller.url ? new URL(controller.url) : null;
    return {
      ...controller,
      endpoint: endpoint ?? { url: "", secret: "" },
      targetKind: kind,
      hostname: url?.hostname ?? "",
      port: url?.port || (url?.protocol === "https:" ? "443" : "80"),
      protocol: url?.protocol ?? "",
    };
  }, [clashx, hosts, selected, location.search, data, verifiedMeta]);
  useEffect(() => {
    if (info.targetKind !== "daemon" || !data) return;
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="external-controller"]',
    )?.content;
    if (meta) setVerifiedMeta(meta);
  }, [info.targetKind, data, setVerifiedMeta]);
  return info;
}
/** Core API client; null while the target has no verified endpoint (offline daemon). */
export function useClient() {
  const {
    endpoint: { url, secret },
  } = useAPIInfo();
  return useMemo(
    () => (url ? Client.forController(url, secret) : null),
    [url, secret],
  );
}

export const identityAtom = atom(true);
