import {
  migrateExternals,
  resolveControlTarget,
  type Controller,
  type Endpoint,
  type TargetSelection,
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

/**
 * 舊鍵一次性遷移：`controllers.v2` 混著本機身份副本與外部控制器，遷移時
 * 丟棄本機身份（migrateExternals 負責識別），選中的 "default" 視為本機。
 */
function migrateLegacy(): {
  externals: Controller[];
  selection: TargetSelection;
} {
  const legacyList = readStorage("controllers.v2");
  const externals = migrateExternals(legacyList);
  const legacySelected = readStorage("controller.selected.v2");
  let selection: TargetSelection = { kind: "daemon" };
  if (
    typeof legacySelected === "string" &&
    legacySelected !== "default" &&
    externals.some((item) => item.id === legacySelected)
  )
    selection = { kind: "controller", id: legacySelected };
  if (legacyList !== null) {
    try {
      localStorage.removeItem("controllers.v2");
    } catch {}
  }
  if (legacySelected !== null) {
    try {
      localStorage.removeItem("controller.selected.v2");
    } catch {}
  }
  return { externals, selection };
}

const migrated = migrateLegacy();

export const externalsStorageAtom = atomWithStorage<Controller[]>(
  "external-controllers.v1",
  migrated.externals,
  undefined,
  { getOnInit: true },
);
export const targetSelectionAtom = atomWithStorage<TargetSelection>(
  "target.selected.v1",
  migrated.selection,
  undefined,
  { getOnInit: true },
);

/** 外部控制器列表：只含用戶顯式添加的條目，本機 daemon 不在其中。 */
export function useExternals() {
  const [saved, set] = useAtom(externalsStorageAtom);
  const externals = useMemo(() => migrateExternals(saved), [saved]);
  return [externals, set] as const;
}

export function useSelectTarget() {
  const [, set] = useAtom(targetSelectionAtom);
  const location = useLocation();
  const navigate = useNavigate();
  return useCallback(
    (selection: TargetSelection) => {
      const qs = new URLSearchParams(location.search);
      for (const name of ["host", "port", "secret", "protocol"])
        qs.delete(name);
      document.querySelector('meta[name="external-controller"]')?.remove();
      set(selection);
      navigate(
        { pathname: location.pathname, search: qs.toString() },
        { replace: true },
      );
    },
    [location, navigate, set],
  );
}

const clashxConfigAtom = atom<Controller | null>(null);

/**
 * 當前控制目標的解析結果。daemon 分支沒有 controller 欄位；endpoint 為
 * 空 url 時表示離線（傳輸層等待，不猜地址）。"none" 只出現在純 Web 且
 * 未保存任何外部控制器的組合下。
 */
const EMPTY_ENDPOINT: Endpoint = { url: "", secret: "" };

export type TargetInfo =
  | {
      targetKind: "daemon";
      endpoint: Endpoint;
      hostname: string;
      port: string;
      protocol: string;
      focusKey: string;
    }
  | {
      targetKind: "controller";
      controller: Controller;
      endpoint: Endpoint;
      hostname: string;
      port: string;
      protocol: string;
      focusKey: string;
    }
  | {
      targetKind: "none";
      endpoint: Endpoint;
      hostname: string;
      port: string;
      protocol: string;
      focusKey: string;
    };

export function useAPIInfo(): TargetInfo {
  const [clashx, setClashx] = useAtom(clashxConfigAtom);
  useEffect(() => {
    if (!isClashX() || !jsBridge || clashx) return;
    void jsBridge.getAPIInfo().then((info) => {
      setClashx({
        id: "clashx",
        name: "ClashX",
        url: `http://${info.host}:${info.port}`,
        secret: info.secret,
      });
    });
  }, [clashx, setClashx]);
  const { data, config } = useDaemonConnection();
  const location = useLocation();
  const selection = useAtomValue(targetSelectionAtom);
  const saved = useAtomValue(externalsStorageAtom);
  const externals = useMemo(() => migrateExternals(saved), [saved]);
  const info = useMemo<TargetInfo>(() => {
    const proxyPath = document.querySelector<HTMLMetaElement>(
      'meta[name="localapi-controller"]',
    )?.content;
    const target = resolveControlTarget(externals, selection, {
      meta: document.querySelector<HTMLMetaElement>(
        'meta[name="external-controller"]',
      )?.content,
      search: location.search,
      bridge: clashx,
      daemon: hasDaemonConfig()
        ? {
            core:
              proxyPath && config && data?.engine.running
                ? {
                    url: new URL(proxyPath, window.location.origin).href,
                    secret: config.token,
                  }
                : !proxyPath && data
                  ? {
                      url: `http://127.0.0.1:${data.preferences.clashPort}`,
                      secret: data.preferences.clashSecret ?? "",
                    }
                  : undefined,
          }
        : null,
    });
    if (target.kind === "daemon") {
      const endpoint = target.endpoint ?? EMPTY_ENDPOINT;
      const parsedEndpoint = endpoint.url ? new URL(endpoint.url) : null;
      return {
        targetKind: "daemon",
        endpoint,
        hostname: parsedEndpoint?.hostname ?? "127.0.0.1",
        port: parsedEndpoint
          ? parsedEndpoint.port ||
            (parsedEndpoint.protocol === "https:" ? "443" : "80")
          : "",
        protocol: parsedEndpoint?.protocol ?? "http:",
        focusKey: "daemon",
      };
    }
    if (target.kind === "none")
      return {
        targetKind: "none",
        endpoint: EMPTY_ENDPOINT,
        hostname: "",
        port: "",
        protocol: "",
        focusKey: "none",
      };
    const url = new URL(target.controller.url);
    return {
      targetKind: "controller",
      controller: target.controller,
      endpoint: target.endpoint,
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? "443" : "80"),
      protocol: url.protocol,
      focusKey: controllerIdentity(target.controller.id, target.controller.url),
    };
  }, [clashx, externals, selection, location.search, data, config]);
  return info;
}

function controllerIdentity(id: string, address: string): string {
  const url = new URL(address);
  return JSON.stringify([id, url.origin, url.pathname]);
}

/** 核心 API 客戶端；無已驗證端點（本機離線、無目標）時為 null。 */
export function useClient() {
  const { endpoint } = useAPIInfo();
  return useMemo(
    () =>
      endpoint.url ? Client.forController(endpoint.url, endpoint.secret) : null,
    [endpoint],
  );
}

export const identityAtom = atom(true);
