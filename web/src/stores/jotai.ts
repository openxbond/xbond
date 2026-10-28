import {
  Language,
  locales,
  type Lang,
  getDefaultLanguage,
  type LocalizedType,
} from "@i18n";
import { coreCapabilities } from "@lib/capabilities";
import { streamURL } from "@lib/controller";
import { partition } from "@lib/helper";
import { useWarpImmerSetter, type WritableDraft } from "@lib/jotai";
import { isClashX, jsBridge } from "@lib/jsBridge";
import type * as API from "@lib/request";
import { StreamReader, type StreamState } from "@lib/streamer";
import { type Infer } from "@lib/type";
import { type Log } from "@models/Log";
import { isAxiosError } from "axios";
import { produce } from "immer";
import { atom, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as R from "remeda";
import useSWR from "swr";
import { type Get } from "type-fest";

import { useAPIInfo, useClient } from "./request";

export const identityAtom = atom(true);

export const languageAtom = atomWithStorage<Lang | undefined>(
  "language",
  undefined,
);

export type ThemePreference = "light" | "dark" | "system";

export const themeAtom = atomWithStorage<ThemePreference | undefined>(
  "theme",
  undefined,
);

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function resolveDark(pref: ThemePreference | undefined) {
  if (pref === "light") return false;
  if (pref === "dark") return true;
  return darkQuery.matches;
}

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  // Browsers refuse a theme-color they cannot parse — hex, not oklch.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#0a0a0a" : "#f7f7f7");
}

/**
 * Applies the theme preference to <html>. index.html carries the same
 * resolution inline as an anti-flash script, so this only handles runtime
 * changes: preference switches and the system theme following along.
 */
export function useTheme() {
  const [theme] = useAtom(themeAtom);

  useEffect(() => {
    applyTheme(resolveDark(theme));
    if (theme === "light" || theme === "dark") return;

    const onChange = () => applyTheme(darkQuery.matches);
    darkQuery.addEventListener("change", onChange);
    return () => darkQuery.removeEventListener("change", onChange);
  }, [theme]);

  return theme;
}

export function useI18n() {
  const [defaultLang, setLang] = useAtom(languageAtom);
  const lang = useMemo(
    () => defaultLang ?? getDefaultLanguage(),
    [defaultLang],
  );

  const translation = useCallback(
    function <Namespace extends keyof LocalizedType>(namespace: Namespace) {
      function t<Path extends Infer<LocalizedType[Namespace]>>(path: Path) {
        type returnType = Get<LocalizedType[Namespace], Path>;
        const obj = Language[lang][namespace];
        const objPath = R.stringToPath(path);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return R.pathOr(obj, objPath as any, "" as any) as returnType;
      }
      return { t };
    },
    [lang],
  );

  return { lang, locales, setLang, translation };
}

const emptyVersion = { version: "", premium: false, meta: false };
export function useVersion() {
  const client = useClient();
  const result = useSWR(
    ["/version", client],
    async () => {
      const { data } = await client.getVersion();
      return {
        version: data.version || "",
        premium: !!data.premium,
        meta: !!data.meta,
      };
    },
    { shouldRetryOnError: false },
  );
  return result.data ?? emptyVersion;
}

export const configAtom = atomWithStorage("profile", {
  breakConnections: false,
  logLevel: "",
  testURL: "https://www.gstatic.com/generate_204",
  testTimeout: 5000,
});
export function useConfig() {
  const [data, set] = useAtom(configAtom);
  const setter = useCallback(
    (f: WritableDraft<typeof data>) => {
      set(produce(data, f));
    },
    [data, set],
  );
  return { data, set: useWarpImmerSetter(setter) };
}

const emptyGeneral = {
  mode: "",
  modeList: undefined,
  allowLan: false,
  logLevel: undefined,
  port: undefined,
  socksPort: undefined,
  mixedPort: 0,
};
export function useGeneral() {
  const client = useClient();
  const result = useSWR(["/configs", client], async () => {
    const { data } = await client.getConfig();
    return {
      port: data.port,
      socksPort: data["socks-port"],
      mixedPort: data["mixed-port"] ?? 0,
      redirPort: data["redir-port"],
      mode: data.mode ?? "",
      modeList: data["mode-list"],
      logLevel: data["log-level"],
      allowLan: data["allow-lan"],
    };
  });
  return {
    general: result.data ?? emptyGeneral,
    update: result.mutate,
    error: result.error,
  };
}
export function useCapabilities() {
  const version = useVersion();
  const { general } = useGeneral();
  return coreCapabilities(version, general.modeList);
}

export function useRuleProviders() {
  const client = useClient();
  const capabilities = useCapabilities();
  const { data, mutate, error } = useSWR(
    capabilities.ruleProviders ? ["/providers/rules", client] : null,
    async () => {
      try {
        return Object.values(
          (await client.getRuleProviders()).data.providers ?? {},
        );
      } catch (error) {
        if (
          isAxiosError(error) &&
          [404, 405, 501].includes(error.response?.status ?? 0)
        )
          return [];
        throw error;
      }
    },
  );
  return { providers: data ?? [], update: mutate, error };
}
export function useProxyProviders() {
  const client = useClient();
  const capabilities = useCapabilities();
  const { data, mutate, error } = useSWR(
    capabilities.proxyProviders ? ["/providers/proxies", client] : null,
    async () => {
      return Object.values(
        (await client.getProxyProviders()).data.providers ?? {},
      ).filter((p) => p.name !== "default" && p.vehicleType !== "Compatible");
    },
  );
  return { providers: data ?? [], update: mutate, error };
}

interface ProxyState {
  proxies: API.Proxy[];
  groups: API.Group[];
  global: API.Group;
}
const emptyProxies: ProxyState = {
  proxies: [],
  groups: [],
  global: { name: "GLOBAL", type: "Fallback", all: [], now: "", history: [] },
};
export function useProxy() {
  const client = useClient();
  const { data, mutate, error } = useSWR(["/proxies", client], async () => {
    const mapping = (await client.getProxies()).data.proxies ?? {};
    const global = {
      ...emptyProxies.global,
      ...mapping.GLOBAL,
      name: "GLOBAL",
    } as API.Group;
    const entries = (global.all.length ? global.all : Object.keys(mapping))
      .filter(
        (name) =>
          !["GLOBAL", "DIRECT", "REJECT"].includes(name) && mapping[name],
      )
      .map((name) => ({
        ...mapping[name],
        name,
        history: mapping[name].history ?? [],
      }));
    const [proxies, groups] = partition(entries, (p) => !("all" in p));
    return {
      proxies: proxies as API.Proxy[],
      groups: groups as API.Group[],
      global,
    };
  });
  const set = useCallback(
    (update: (draft: ProxyState) => void) => {
      void mutate((current) => produce(current ?? emptyProxies, update), {
        revalidate: false,
      });
    },
    [mutate],
  );
  const markProxySelected = useCallback(
    (name: string, selected: string) => {
      set((draft) => {
        if (name === "GLOBAL") draft.global.now = selected;
        for (const group of draft.groups)
          if (group.name === name) group.now = selected;
      });
    },
    [set],
  );
  return {
    ...(data ?? emptyProxies),
    update: mutate,
    markProxySelected,
    set,
    error,
  };
}
export function useProxyMapping() {
  const { proxies, groups, global } = useProxy();
  const { providers } = useProxyProviders();
  return useMemo(() => {
    const mapping = new Map<string, API.Proxy | API.Group>();
    for (const item of [
      ...proxies,
      ...groups,
      global,
      ...providers.flatMap((p) => p.proxies),
    ])
      mapping.set(item.name, item);
    return mapping;
  }, [proxies, groups, global, providers]);
}

export function useClashXData() {
  const { data, mutate } = useSWR("/clashx", async () => {
    if (!isClashX())
      return { isClashX: false, startAtLogin: false, systemProxy: false };
    return {
      isClashX: true,
      startAtLogin: (await jsBridge?.getStartAtLogin()) ?? false,
      systemProxy: (await jsBridge?.isSystemProxySet()) ?? false,
    };
  });
  return { data, update: mutate };
}
export function useRule() {
  const client = useClient();
  const { data, mutate, error } = useSWR(
    ["/rules", client],
    async () => (await client.getRules()).data.rules ?? [],
  );
  return { rules: data ?? [], update: mutate, error };
}

export function useStreamReader<T>(path: string | null, bufferLength = 0) {
  const { url, secret } = useAPIInfo();
  const connection = useMemo(
    () => ({
      stream: new StreamReader<T>({ bufferLength }),
      endpoint: path ? streamURL(url, path, secret) : null,
    }),
    [url, secret, path, bufferLength],
  );
  const { stream, endpoint } = connection;
  useEffect(() => {
    if (endpoint) stream.connect(endpoint);
    return () => stream.disconnect();
  }, [stream, endpoint]);
  return stream;
}
export function useStreamState<T>(stream: StreamReader<T>) {
  const [state, setState] = useState<StreamState>("connecting");
  useEffect(() => stream.subscribeState(setState), [stream]);
  return state;
}
export function useLogsStreamReader() {
  const { general } = useGeneral();
  const {
    data: { logLevel },
  } = useConfig();
  return useStreamReader<Log>(
    logLevel === "silent" || general.logLevel === "silent"
      ? null
      : `logs?level=${logLevel || general.logLevel || "info"}`,
    1000,
  );
}
export function useConnectionStreamReader() {
  return useStreamReader<API.Snapshot>("connections");
}
